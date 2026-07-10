#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct HeaderWork {
    pub midstate: [u32; 8],
    pub tail: [u32; 3],
}

pub trait HashEngine {
    fn hash_words(&mut self, work: &HeaderWork, nonce: u32) -> [u32; 8];
}
