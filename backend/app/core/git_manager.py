"""Git 仓库管理器"""
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

import pygit2

from app.config import settings
from app.utils.logger import logger
from app.utils.validator import validate_file_path, validate_git_url


@dataclass
class GitCommit:
    """Git 提交记录"""
    hash: str
    message: str
    author: str
    timestamp: datetime


@dataclass
class GitStatus:
    """Git 状态"""
    branch: str
    is_clean: bool
    modified_files: List[str]
    untracked_files: List[str]


class GitManager:
    """Git 仓库管理器"""
    
    def __init__(self, workspace: Path):
        self.workspace = workspace.resolve()
        self.workspace.mkdir(parents=True, exist_ok=True)
    
    def clone_repository(self, url: str, name: Optional[str] = None) -> Path:
        """克隆 Git 仓库"""
        validated_url = validate_git_url(url)
        
        # 生成仓库名称
        if not name:
            name = validated_url.split('/')[-1].replace('.git', '')
        
        repo_path = self.workspace / name
        
        if repo_path.exists():
            raise ValueError(f"仓库目录已存在: {repo_path}")
        
        logger.info(f"开始克隆仓库: {validated_url} -> {repo_path}")
        
        try:
            # 使用回调函数显示进度
            class CloneProgress(pygit2.RemoteCallbacks):
                def transfer_progress(self, stats):
                    if stats.received_objects > 0:
                        pct = stats.received_objects / stats.total_objects * 100
                        logger.debug(f"克隆进度: {pct:.1f}%")
            
            pygit2.clone_repository(
                validated_url,
                str(repo_path),
                callbacks=CloneProgress()
            )
            
            logger.info(f"仓库克隆成功: {repo_path}")
            return repo_path
            
        except Exception as e:
            logger.error(f"克隆仓库失败: {e}")
            # 清理失败的克隆
            if repo_path.exists():
                import shutil
                shutil.rmtree(repo_path)
            raise
    
    def open_repository(self, path: Path) -> pygit2.Repository:
        """打开本地仓库"""
        repo_path = validate_file_path(str(path))
        
        if not repo_path.exists():
            raise ValueError(f"仓库路径不存在: {repo_path}")
        
        try:
            return pygit2.Repository(str(repo_path))
        except Exception as e:
            raise ValueError(f"无法打开 Git 仓库: {e}")
    
    def get_status(self, repo_path: Path) -> GitStatus:
        """获取仓库状态"""
        repo = self.open_repository(repo_path)
        
        # 获取当前分支
        if repo.head_is_unborn:
            branch = "HEAD (unborn)"
        else:
            branch = repo.head.shorthand
        
        # 获取状态
        status = repo.status()
        modified = []
        untracked = []
        
        for filepath, flags in status.items():
            if flags & pygit2.GIT_STATUS_WT_MODIFIED:
                modified.append(filepath)
            if flags & pygit2.GIT_STATUS_WT_NEW:
                untracked.append(filepath)
        
        return GitStatus(
            branch=branch,
            is_clean=len(status) == 0,
            modified_files=modified,
            untracked_files=untracked
        )
    
    def get_recent_commits(self, repo_path: Path, limit: int = 10) -> List[GitCommit]:
        """获取最近的提交记录"""
        repo = self.open_repository(repo_path)
        
        if repo.head_is_unborn:
            return []
        
        commits = []
        for commit in repo.walk(repo.head.target, pygit2.GIT_SORT_TIME):
            commits.append(GitCommit(
                hash=str(commit.id),
                message=commit.message.strip(),
                author=commit.author.name,
                timestamp=datetime.fromtimestamp(commit.commit_time, tz=timezone.utc)
            ))
            
            if len(commits) >= limit:
                break
        
        return commits
    
    def pull_repository(self, repo_path: Path) -> Dict[str, Any]:
        """拉取远程更新"""
        repo = self.open_repository(repo_path)
        
        if repo.head_is_unborn:
            raise ValueError("仓库没有初始提交")
        
        # 获取当前分支的远程跟踪
        branch = repo.head.shorthand
        upstream = repo.branches[branch].upstream
        remote_name = upstream.remote_name if upstream else "origin"
        
        remote = repo.remotes[remote_name]
        remote.fetch()
        
        # 合并远程分支
        remote_ref = f"refs/remotes/{remote_name}/{branch}"
        remote_commit = repo.references[remote_ref].target
        
        # 执行快进合并
        repo.merge(remote_commit)
        
        if repo.state == pygit2.GIT_REPO_STATE_MERGE:
            # 如果有冲突，需要手动解决
            raise ValueError("合并冲突，需要手动解决")
        
        return {
            "status": "success",
            "branch": branch,
            "remote": remote_name
        }
    
    def commit_changes(
        self, repo_path: Path, message: str, files: Optional[List[str]] = None
    ) -> str:
        """提交更改"""
        repo = self.open_repository(repo_path)
        
        # 添加文件到索引
        if files:
            for file in files:
                repo.index.add(file)
        else:
            # 添加所有更改
            repo.index.add_all()
        
        repo.index.write()
        
        # 创建提交
        tree = repo.index.write_tree()
        
        if repo.head_is_unborn:
            # 首次提交
            sig = repo.default_signature
            commit = repo.create_commit(
                "HEAD",
                sig,
                sig,
                message,
                tree,
                []
            )
        else:
            # 正常提交
            parent = repo.head.peel(pygit2.Commit)
            sig = repo.default_signature
            commit = repo.create_commit(
                "HEAD",
                sig,
                sig,
                message,
                tree,
                [parent.id]
            )
        
        logger.info(f"提交成功: {commit}")
        return str(commit)


# 全局实例（使用配置的工作空间）
git_manager = GitManager(settings.git_workspace)
