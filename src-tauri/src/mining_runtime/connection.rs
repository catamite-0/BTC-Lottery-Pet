use std::{net::TcpStream, time::Duration};

pub(crate) fn connect_to_pool(
    address: &str,
    socket_addresses: &[std::net::SocketAddr],
) -> Result<TcpStream, String> {
    if socket_addresses.is_empty() {
        return Err(format!("no address found for {address}"));
    }

    let mut failures = Vec::new();
    for socket_address in socket_addresses {
        match TcpStream::connect_timeout(socket_address, Duration::from_secs(4)) {
            Ok(stream) => return Ok(stream),
            Err(error) => failures.push(format!("{socket_address}: {error}")),
        }
    }

    Err(format!(
        "could not connect to {address}: {}",
        failures.join("; ")
    ))
}
