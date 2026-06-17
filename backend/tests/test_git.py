"""Git 管理器测试"""
import pytest
import tempfile
from pathlib import Path
from app.core.git_manager import GitManager, GitStatus, GitCommit


@pytest.fixture
def temp_workspace():
    """创建临时工作空间"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


@pytest.fixture
def local_repo(temp_workspace):
    """创建一个本地 Git 仓库用于测试"""
    import pygit2
    
    repo_path = temp_workspace / "test-repo"
    repo_path.mkdir()
    
    # 初始化仓库
    repo = pygit2.init_repository(str(repo_path))
    
    # 配置 git 用户信息
    config = repo.config
    config['user.name'] = 'Test User'
    config['user.email'] = 'test@example.com'
    
    # 创建一个文件并提交
    test_file = repo_path / "README.md"
    test_file.write_text("# Test Repository\n\nThis is a test.")
    
    repo.index.add("README.md")
    repo.index.write()
    
    tree = repo.index.write_tree()
    sig = pygit2.Signature("Test User", "test@example.com")
    repo.create_commit(
        "HEAD",
        sig,
        sig,
        "Initial commit",
        tree,
        []
    )
    
    return repo_path


def test_git_manager_init(temp_workspace):
    """测试 GitManager 初始化"""
    manager = GitManager(temp_workspace)
    assert manager.workspace == temp_workspace.resolve()
    assert manager.workspace.exists()


def test_open_repository(local_repo):
    """测试打开本地仓库"""
    manager = GitManager(local_repo.parent)
    repo = manager.open_repository(local_repo)
    assert repo is not None
    assert not repo.head_is_unborn


def test_open_invalid_repository(temp_workspace):
    """测试打开无效仓库"""
    manager = GitManager(temp_workspace)
    with pytest.raises(ValueError, match="仓库路径不存在"):
        manager.open_repository(temp_workspace / "nonexistent")


def test_get_status(local_repo):
    """测试获取仓库状态"""
    manager = GitManager(local_repo.parent)
    status = manager.get_status(local_repo)
    
    assert isinstance(status, GitStatus)
    assert status.branch == "master" or status.branch == "main"
    assert status.is_clean is True
    assert len(status.modified_files) == 0
    assert len(status.untracked_files) == 0


def test_get_status_with_changes(local_repo):
    """测试有修改时的仓库状态"""
    manager = GitManager(local_repo.parent)
    
    # 修改文件
    (local_repo / "README.md").write_text("Modified content")
    # 添加新文件
    (local_repo / "new_file.txt").write_text("New file")
    
    status = manager.get_status(local_repo)
    
    assert status.is_clean is False
    assert "README.md" in status.modified_files
    assert "new_file.txt" in status.untracked_files


def test_get_recent_commits(local_repo):
    """测试获取提交记录"""
    manager = GitManager(local_repo.parent)
    
    commits = manager.get_recent_commits(local_repo, limit=5)
    
    assert len(commits) == 1
    assert isinstance(commits[0], GitCommit)
    assert commits[0].message == "Initial commit"
    assert commits[0].author == "Test User"
    assert commits[0].hash


def test_commit_changes(local_repo):
    """测试提交更改"""
    manager = GitManager(local_repo.parent)
    
    # 添加新文件
    new_file = local_repo / "new_feature.py"
    new_file.write_text("print('hello')")
    
    commit_hash = manager.commit_changes(local_repo, "Add new feature")
    
    assert commit_hash
    assert len(commit_hash) == 40  # SHA1 hash 长度
    
    # 验证提交记录
    commits = manager.get_recent_commits(local_repo, limit=5)
    assert len(commits) == 2
    assert commits[0].message == "Add new feature"


def test_commit_specific_files(local_repo):
    """测试提交指定文件"""
    manager = GitManager(local_repo.parent)
    
    # 添加多个文件
    (local_repo / "file1.py").write_text("file1")
    (local_repo / "file2.py").write_text("file2")
    
    # 只提交 file1.py
    commit_hash = manager.commit_changes(
        local_repo,
        "Add file1 only",
        files=["file1.py"]
    )
    
    assert commit_hash
    
    # 验证状态 - file2.py 应该还在未跟踪中
    status = manager.get_status(local_repo)
    assert "file2.py" in status.untracked_files


def test_clone_invalid_url(temp_workspace):
    """测试克隆无效 URL"""
    manager = GitManager(temp_workspace)
    
    from app.utils.validator import ValidationError
    with pytest.raises(ValidationError):
        manager.clone_repository("not-a-valid-url")


def test_clone_existing_directory(local_repo):
    """测试克隆到已存在的目录"""
    manager = GitManager(local_repo.parent)
    
    with pytest.raises(ValueError, match="仓库目录已存在"):
        manager.clone_repository(
            "https://github.com/test/repo.git",
            name=local_repo.name
        )
