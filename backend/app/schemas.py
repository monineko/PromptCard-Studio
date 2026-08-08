from typing import Optional

from pydantic import BaseModel


class CategoryIn(BaseModel):
    name: str


class CategoryRename(BaseModel):
    old_name: str
    new_name: str


class CardIn(BaseModel):
    category: str
    name: str
    content: str


class CardUpdate(BaseModel):
    category: str
    name: str
    content: str
    new_category: Optional[str] = None
    new_name: Optional[str] = None


class CardImageIn(BaseModel):
    category: str
    name: str
    path: str


class CardPinIn(BaseModel):
    category: str = ""
    name: str = ""


class ExpandRequest(BaseModel):
    text: str


class WorkspaceIn(BaseModel):
    positive: list
    negative: list


class AnrImportIn(BaseModel):
    path: str


class CategoryOrder(BaseModel):
    names: list[str]


class CategoryColor(BaseModel):
    name: str
    hue: int


class ReviewMove(BaseModel):
    path: str
    tag: str


class ReviewApplyIn(BaseModel):
    moves: list[ReviewMove] = []
    recycle_reject: bool = True


class ReviewUndoIn(BaseModel):
    token: str


class ImportPathIn(BaseModel):
    path: str


class MoveImagesIn(BaseModel):
    paths: list[str] = []
    target: str


class DeleteImagesIn(BaseModel):
    paths: list[str] = []


class SetCoverIn(BaseModel):
    category: str
    path: str


class GenerateTokenIn(BaseModel):
    token: str = ""


class VibeRenameIn(BaseModel):
    id: str = ""
    name: str = ""


class Text2ImageIn(BaseModel):
    prompt: str = ""
    negative_prompt: str = ""
    params: dict = {}


class BatchCardIn(BaseModel):
    category: str
    name: str
    coefficient: int = 1


class BatchDimensionIn(BaseModel):
    name: str
    cards: list[BatchCardIn] = []


class BatchStartIn(BaseModel):
    base_positive: str = ""
    negative: str = ""
    dimensions: list[BatchDimensionIn] = []
    params: dict = {}
    stop_anlas: int = 0


class PngSendIn(BaseModel):
    png: dict = {}
    model: str = ""


class VibeImportIn(BaseModel):
    name: str = ""
    encoding: str = ""
    strength: float = 0.7
    information_extracted: float | None = None
    model: str = ""
