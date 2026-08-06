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


class ExpandRequest(BaseModel):
    text: str


class WorkspaceIn(BaseModel):
    positive: list
    negative: list


class AnrImportIn(BaseModel):
    path: str


class CategoryOrder(BaseModel):
    names: list[str]
