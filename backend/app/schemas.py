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
    back_note: Optional[str] = None


class DictionaryBatchIn(BaseModel):
    terms: list[str] = []


class DictionarySaveIn(BaseModel):
    term: str = ""
    cn: str = ""


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


class VibeFolderIn(BaseModel):
    name: str = ""


class VibeFolderRenameIn(BaseModel):
    name: str = ""
    new_name: str = ""


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


class StyleExplorePoolIn(BaseModel):
    name: str = ""
    content: str = ""


class StyleExplorePoolUpdateIn(BaseModel):
    content: str = ""
    name: Optional[str] = None


class StyleExplorePoolBackupRestoreIn(BaseModel):
    name: str = ""


class StyleExploreRunIn(BaseModel):
    name: str = ""
    pool_id: str = ""
    target_count: int = 1
    positive: str = ""
    negative: str = ""
    params: dict = {}
    algorithm: dict = {}
    phase: str = "basic"


class StyleExploreRunUpdateIn(BaseModel):
    name: str = ""


class StyleExploreResumeIn(BaseModel):
    params: dict = {}


class StyleExploreBasicRoundIn(BaseModel):
    target_count: int = 1
    positive: str = ""
    negative: str = ""
    params: dict = {}
    algorithm: dict = {}


class StyleExploreDeepParentsIn(BaseModel):
    candidate_ids: list[str] = []
    custom_artist_strings: list[str] = []


class StyleExploreAestheticBranchIn(BaseModel):
    source_round_id: str = ""
    name: str = ""
    candidate_ids: list[str] = []


class StyleExploreDeepPreferenceIn(BaseModel):
    left_parent_id: str = ""
    right_parent_id: str = ""
    result: str = "skip"


class StyleExploreDeepRoundIn(BaseModel):
    parent_set_id: Optional[str] = None
    target_count: int = 10
    positive: str = ""
    negative: str = ""
    params: dict = {}
    algorithm: dict = {}


class StyleExploreCandidatesIn(BaseModel):
    candidates: list[dict] = []


class StyleExploreCandidateUpdateIn(BaseModel):
    generation: Optional[dict] = None
    review: Optional[dict] = None


class StyleExploreCandidateCardIn(BaseModel):
    name: str = ""


class StyleExploreReviewMove(BaseModel):
    candidate_id: str
    tag: str


class StyleExploreReviewsIn(BaseModel):
    moves: list[StyleExploreReviewMove] = []


class PngSendIn(BaseModel):
    png: dict = {}
    model: str = ""


class VibeImportIn(BaseModel):
    name: str = ""
    encoding: str = ""
    strength: float = 0.7
    information_extracted: float | None = None
    model: str = ""
    folder: str = ""


class PublishRunIn(BaseModel):
    staged: list[str] = []
    nodes: dict = {}
    rename: dict = {}
    engine_params: dict = {}
    mosaic_params: dict = {}


class PublishStageIn(BaseModel):
    paths: list[str] = []


class PublishEngineParamsIn(BaseModel):
    engine: str = ""
    params: dict = {}


class PublishEngineLocalPathIn(BaseModel):
    path: str = ""


class PublishRenamePreviewIn(BaseModel):
    rename: dict = {}
