"""PCG32 — the engine's only randomness source, used exclusively by map generation.

Self-contained so determinism never depends on Python's `random` module internals.
"""

MASK64 = (1 << 64) - 1
MASK32 = (1 << 32) - 1
_MULT = 6364136223846793005


class PCG32:
    def __init__(self, seed: int, seq: int = 54) -> None:
        self.state = 0
        self.inc = ((seq << 1) | 1) & MASK64
        self.next_u32()
        self.state = (self.state + (seed & MASK64)) & MASK64
        self.next_u32()

    def next_u32(self) -> int:
        old = self.state
        self.state = (old * _MULT + self.inc) & MASK64
        xorshifted = (((old >> 18) ^ old) >> 27) & MASK32
        rot = old >> 59
        return ((xorshifted >> rot) | (xorshifted << ((-rot) & 31))) & MASK32

    def randint(self, n: int) -> int:
        """Uniform-ish integer in [0, n). Modulo bias is irrelevant here (n << 2^32)."""
        return self.next_u32() % n

    def choice(self, seq: list) -> object:
        return seq[self.randint(len(seq))]
