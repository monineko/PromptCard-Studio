# Cards stored as plain-text files, database as index only

Cards live on disk as `<分类>/<名称>.txt` and are the source of truth; the database is a search/query index that can be rebuilt from disk at any time. This keeps data compatible with existing ANR wildcards folders, keeps every card a plain-text file users can edit by hand, and avoids a migration step for the current ANR data. The previous tool's "must click refresh" problem is solved in the UI layer (live watch + rebuild), not by moving storage into the database.
