use std::{
    collections::HashSet,
    net::{SocketAddr, TcpStream, ToSocketAddrs},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, RecvTimeoutError},
    },
    thread,
    time::{Duration, Instant},
};

const DNS_STOP_POLL_INTERVAL: Duration = Duration::from_millis(50);
const DNS_RESOLUTION_TIMEOUT: Duration = Duration::from_secs(10);
const CONNECT_ATTEMPT_TIMEOUT: Duration = Duration::from_secs(1);
const CONNECT_TOTAL_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_POOL_ADDRESSES: usize = 8;

type ResolutionResult = Result<Vec<SocketAddr>, String>;
static DNS_RESOLVER_ACTIVE: AtomicBool = AtomicBool::new(false);

struct DnsResolverPermit<'a> {
    active: &'a AtomicBool,
}

fn try_acquire_dns_resolver(active: &AtomicBool) -> Option<DnsResolverPermit<'_>> {
    active
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .ok()?;
    Some(DnsResolverPermit { active })
}

impl Drop for DnsResolverPermit<'_> {
    fn drop(&mut self) {
        self.active.store(false, Ordering::Release);
    }
}

pub(crate) fn resolve_pool_addresses(
    address: &str,
    pool_host: &str,
    stop: &AtomicBool,
) -> Result<Option<Vec<SocketAddr>>, String> {
    if stop.load(Ordering::Acquire) {
        return Ok(None);
    }

    let permit = try_acquire_dns_resolver(&DNS_RESOLVER_ACTIVE)
        .ok_or_else(|| "a previous DNS resolution is still in progress".to_string())?;
    let owned_address = address.to_owned();
    let owned_host = pool_host.to_owned();
    let (sender, receiver) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("btc-lottery-dns".into())
        .spawn(move || {
            let _permit = permit;
            let result = owned_address
                .to_socket_addrs()
                .map(|addresses| bounded_unique_addresses(addresses.collect()))
                .map_err(|error| format!("DNS failed for {owned_host}: {error}"));
            let _ = sender.send(result);
        })
        .map_err(|error| format!("failed to start DNS resolver: {error}"))?;

    wait_for_resolution(&receiver, stop, DNS_RESOLUTION_TIMEOUT)
}

fn bounded_unique_addresses(addresses: Vec<SocketAddr>) -> Vec<SocketAddr> {
    let mut seen = HashSet::new();
    addresses
        .into_iter()
        .filter(|address| seen.insert(*address))
        .take(MAX_POOL_ADDRESSES)
        .collect()
}

fn wait_for_resolution(
    receiver: &Receiver<ResolutionResult>,
    stop: &AtomicBool,
    timeout: Duration,
) -> Result<Option<Vec<SocketAddr>>, String> {
    let deadline = Instant::now() + timeout;

    loop {
        if stop.load(Ordering::Acquire) {
            return Ok(None);
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return Err("DNS resolution timed out".into());
        }
        let poll_interval = DNS_STOP_POLL_INTERVAL.min(remaining);

        match receiver.recv_timeout(poll_interval) {
            Ok(result) => return result.map(Some),
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => {
                return Err("DNS resolver stopped without a result".into())
            }
        }
    }
}

pub(crate) fn connect_to_pool(
    address: &str,
    socket_addresses: &[SocketAddr],
    stop: &AtomicBool,
) -> Result<Option<TcpStream>, String> {
    if stop.load(Ordering::Acquire) {
        return Ok(None);
    }
    if socket_addresses.is_empty() {
        return Err(format!("no address found for {address}"));
    }

    let mut failures = Vec::new();
    let deadline = Instant::now() + CONNECT_TOTAL_TIMEOUT;
    for socket_address in socket_addresses {
        if stop.load(Ordering::Acquire) {
            return Ok(None);
        }

        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        let timeout = CONNECT_ATTEMPT_TIMEOUT.min(remaining);
        match TcpStream::connect_timeout(socket_address, timeout) {
            Ok(stream) => return Ok(Some(stream)),
            Err(error) => failures.push(format!("{socket_address}: {error}")),
        }
    }

    if stop.load(Ordering::Acquire) {
        return Ok(None);
    }

    Err(format!(
        "could not connect to {address}: {}",
        failures.join("; ")
    ))
}

#[cfg(test)]
mod tests {
    use std::{
        net::{IpAddr, Ipv4Addr, SocketAddr},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    #[test]
    fn dns_wait_observes_stop_without_waiting_for_resolver() {
        let (_sender, receiver) = mpsc::sync_channel(1);
        let stop = Arc::new(AtomicBool::new(false));
        let signal = Arc::clone(&stop);
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(20));
            signal.store(true, Ordering::Release);
        });

        let started = Instant::now();
        let result = super::wait_for_resolution(&receiver, &stop, Duration::from_secs(1)).unwrap();
        assert!(result.is_none());
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn dns_wait_has_an_absolute_deadline() {
        let (_sender, receiver) = mpsc::sync_channel(1);
        let stop = AtomicBool::new(false);
        let started = Instant::now();
        let error =
            super::wait_for_resolution(&receiver, &stop, Duration::from_millis(20)).unwrap_err();
        assert!(error.contains("timed out"));
        assert!(started.elapsed() < Duration::from_millis(250));
    }

    #[test]
    fn resolver_permit_prevents_thread_accumulation() {
        let active = AtomicBool::new(false);
        let first = super::try_acquire_dns_resolver(&active).unwrap();
        assert!(active.load(Ordering::Acquire));
        assert!(super::try_acquire_dns_resolver(&active).is_none());
        drop(first);
        assert!(!active.load(Ordering::Acquire));
        let second = super::try_acquire_dns_resolver(&active).unwrap();
        drop(second);
        assert!(!active.load(Ordering::Acquire));
    }

    #[test]
    fn address_list_is_deduplicated_and_bounded() {
        let repeated = (0..20)
            .flat_map(|index| {
                let address =
                    SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 0, 2, index + 1)), 3333);
                [address, address]
            })
            .collect();

        let addresses = super::bounded_unique_addresses(repeated);
        assert_eq!(addresses.len(), super::MAX_POOL_ADDRESSES);
        assert_eq!(
            addresses
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            addresses.len()
        );
    }

    #[test]
    fn connect_returns_immediately_when_already_stopped() {
        let stop = AtomicBool::new(true);
        let result = super::connect_to_pool("example.invalid:3333", &[], &stop).unwrap();
        assert!(result.is_none());
    }
}
