"""Git 操作 API"""
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.core.git_manager import git_manager
from app.utils.logger import logger

router = APIRouter(prefix="/git", tags=["git"])


class CloneRequest(BaseModel):
    url: str
    name: Optional[str] = None


class CommitRequest(BaseModel):
    repo_path: str
    message: str
    files: Optional[List[str]] = None


class GitStatusResponse(BaseModel):
    branch: str
    is_clean: bool
    modified_files: List[str]
    untracked_files: List[str]


class GitCommitResponse(BaseModel):
    hash: str
    message: str
    author: str
    timestamp: str


@router.post("/clone")
async def clone_repository(request: CloneRequest):
    """克隆 Git 仓库"""
    try:
        repo_path = git_manager.clone_repository(request.url, request.name)
        return {
            "status": "success",
            "repo_path": str(repo_path),
            "message": f"仓库克隆成功: {repo_path}"
        }
    except Exception as e:
        logger.error(f"克隆仓库失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/status/{repo_path:path}", response_model=GitStatusResponse)
async def get_git_status(repo_path: str):
    """获取仓库状态"""
    try:
        status = git_manager.get_status(Path(repo_path))
        return status
    except Exception as e:
        logger.error(f"获取仓库状态失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/commits/{repo_path:path}", response_model=List[GitCommitResponse])
async def get_recent_commits(
    repo_path: str,
    limit: int = 10
):
    """获取最近的提交记录"""
    try:
        commits = git_manager.get_recent_commits(Path(repo_path), limit)
        return [
            GitCommitResponse(
                hash=c.hash,
                message=c.message,
                author=c.author,
                timestamp=c.timestamp.isoformat()
            )
            for c in commits
        ]
    except Exception as e:
        logger.error(f"获取提交记录失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/pull")
async def pull_repository(repo_path: str):
    """拉取远程更新"""
    try:
        result = git_manager.pull_repository(Path(repo_path))
        return result
    except Exception as e:
        logger.error(f"拉取更新失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/commit")
async def commit_changes(request: CommitRequest):
    """提交更改"""
    try:
        commit_hash = git_manager.commit_changes(
            Path(request.repo_path),
            request.message,
            request.files
        )
        return {
            "status": "success",
            "commit_hash": commit_hash,
            "message": "提交成功"
        }
    except Exception as e:
        logger.error(f"提交失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))
