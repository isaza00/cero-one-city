"""District layout shared with the 3D client (web/src/three/roads.ts).

Every function here is pure 32-bit integer arithmetic so that the Python engine
and the TypeScript renderer produce bit-identical results from the same map
seed: the street grid is not stored in the state, both sides recompute it.
"""

from __future__ import annotations

MASK32 = 0xFFFFFFFF


def terrain_bits(horizontal: int, vertical: int, seed: int = 0) -> int:
    """Same hash as `terrainBits` in web/src/three/roads.ts (unsigned 32-bit)."""
    value = ((horizontal & MASK32) * 374761393 & MASK32) \
        ^ ((vertical & MASK32) * 668265263 & MASK32) ^ (seed & MASK32)
    value = ((value ^ (value >> 13)) * 1274126177) & MASK32
    return (value ^ (value >> 16)) & MASK32


def road_layout(seed: int, fmt: str, size: int) -> tuple[list[int], list[int]]:
    """Centre lines of the avenues: (rows, columns). Roads are 3 tiles wide.

    1v1 maps are 180-degree symmetric (each axis mirrors itself); FFA maps are
    90-degree symmetric, so rows and columns share one mirrored set.
    """
    half = size // 2

    def axis(salt: int, base: int) -> list[int]:
        spacing = base + terrain_bits(1, salt, seed) % 9
        centre = 5 + terrain_bits(2, salt, seed) % (spacing - 6)
        centres: list[int] = []
        while centre < half - 3:
            centres.append(centre + terrain_bits(centre, salt, seed) % 5 - 2)
            centre += spacing
        return centres

    def mirror(centres: list[int]) -> list[int]:
        return sorted(set(centres) | {size - 1 - c for c in centres})

    if fmt == "1v1":
        return mirror(axis(1, 18)), mirror(axis(2, 18))
    both = mirror(axis(3, 24))
    return both, both


def is_road(rows: list[int], cols: list[int], x: int, y: int) -> bool:
    return any(abs(y - r) <= 1 for r in rows) or any(abs(x - c) <= 1 for c in cols)
