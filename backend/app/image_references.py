"""图库图片路径变化时，集中维护各功能保存的图片引用。"""

from dataclasses import dataclass
from typing import Callable, Iterable


@dataclass(frozen=True)
class ImageReferenceStore:
    """一个以字符串键保存图库相对路径的引用存储。"""

    name: str
    load: Callable[[], dict[str, str]]
    save: Callable[[dict[str, str]], None]


def _normalise(path: str) -> str:
    return (path or "").replace("\\", "/")


def rewrite_image_references(
    stores: Iterable[ImageReferenceStore],
    *,
    moved: dict[str, str] | None = None,
    removed: Iterable[str] = (),
) -> dict[str, int]:
    """批量改写或清除图库路径；任一存储失败时回滚已写入的存储。"""

    move_map = {_normalise(old): _normalise(new) for old, new in (moved or {}).items()}
    removed_paths = {_normalise(path) for path in removed}
    pending: list[tuple[ImageReferenceStore, dict[str, str], dict[str, str], int]] = []

    for store in stores:
        original = store.load()
        updated = dict(original)
        changed = 0
        for key, path in list(updated.items()):
            normalised = _normalise(path)
            if normalised in removed_paths:
                updated.pop(key)
                changed += 1
            elif normalised in move_map:
                updated[key] = move_map[normalised]
                changed += 1
        if changed:
            pending.append((store, original, updated, changed))

    saved: list[tuple[ImageReferenceStore, dict[str, str]]] = []
    try:
        for store, original, updated, _ in pending:
            store.save(updated)
            saved.append((store, original))
    except Exception:
        for store, original in reversed(saved):
            try:
                store.save(original)
            except Exception:
                pass
        raise

    return {store.name: changed for store, _, _, changed in pending}
