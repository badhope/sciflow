"""文件归档管理器测试"""
import pytest
import pytest_asyncio
import tempfile
from pathlib import Path
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.core.file_organizer import FileOrganizer
from app.models.file import FileMetadata


@pytest_asyncio.fixture
async def db_session():
    """创建测试数据库会话"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    async_session = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session() as session:
        yield session
    
    await engine.dispose()


@pytest.fixture
def temp_workspace():
    """创建临时工作空间"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_classify_file():
    """测试文件分类"""
    organizer = FileOrganizer(None)
    
    # 测试代码文件
    assert organizer.classify_file(Path("test.py")) == "code"
    assert organizer.classify_file(Path("app.js")) == "code"
    assert organizer.classify_file(Path("main.go")) == "code"
    
    # 测试文档文件
    assert organizer.classify_file(Path("readme.md")) == "document"
    assert organizer.classify_file(Path("notes.txt")) == "document"
    assert organizer.classify_file(Path("report.pdf")) == "document"
    
    # 测试数据文件
    assert organizer.classify_file(Path("config.json")) == "data"
    assert organizer.classify_file(Path("data.csv")) == "data"
    assert organizer.classify_file(Path("settings.yaml")) == "data"
    
    # 测试图片文件
    assert organizer.classify_file(Path("photo.jpg")) == "image"
    assert organizer.classify_file(Path("logo.png")) == "image"
    
    # 测试配置文件
    assert organizer.classify_file(Path("config.toml")) == "config"
    assert organizer.classify_file(Path("settings.ini")) == "config"
    
    # 测试未知类型
    assert organizer.classify_file(Path("unknown.xyz")) == "other"


@pytest.mark.asyncio
async def test_scan_directory(temp_workspace, db_session):
    """测试扫描目录"""
    organizer = FileOrganizer(db_session)
    
    # 创建测试文件
    (temp_workspace / "test1.py").write_text("print('hello')")
    (temp_workspace / "test2.md").write_text("# Test")
    (temp_workspace / "test3.json").write_text("{}")
    
    # 创建子目录和文件
    subdir = temp_workspace / "subdir"
    subdir.mkdir()
    (subdir / "test4.txt").write_text("test")
    
    # 扫描目录
    files = await organizer.scan_directory(temp_workspace)
    
    assert len(files) == 4
    file_names = [f.file_name for f in files]
    assert "test1.py" in file_names
    assert "test2.md" in file_names
    assert "test3.json" in file_names
    assert "test4.txt" in file_names


@pytest.mark.asyncio
async def test_scan_directory_non_recursive(temp_workspace, db_session):
    """测试非递归扫描目录"""
    organizer = FileOrganizer(db_session)
    
    # 创建测试文件
    (temp_workspace / "test1.py").write_text("print('hello')")
    
    # 创建子目录和文件
    subdir = temp_workspace / "subdir"
    subdir.mkdir()
    (subdir / "test2.py").write_text("print('world')")
    
    # 非递归扫描
    files = await organizer.scan_directory(temp_workspace, recursive=False)
    
    assert len(files) == 1
    assert files[0].file_name == "test1.py"


@pytest.mark.asyncio
async def test_create_file_metadata(temp_workspace, db_session):
    """测试创建文件元数据"""
    organizer = FileOrganizer(db_session)
    
    test_file = temp_workspace / "test.py"
    test_file.write_text("print('hello')")
    
    metadata = await organizer.create_file_metadata(test_file)
    
    assert metadata.file_name == "test.py"
    assert metadata.file_path == str(test_file)
    assert metadata.category == "code"
    assert metadata.file_type == ".py"
    assert metadata.size_bytes > 0


@pytest.mark.asyncio
async def test_save_metadata(temp_workspace, db_session):
    """测试保存元数据到数据库"""
    organizer = FileOrganizer(db_session)
    
    test_file = temp_workspace / "test.py"
    test_file.write_text("print('hello')")
    
    metadata = await organizer.create_file_metadata(test_file)
    saved = await organizer.save_metadata(metadata)
    
    assert saved.id is not None
    assert saved.file_name == "test.py"
    
    # 验证数据库中有记录
    files = await organizer.search_files()
    assert len(files) == 1
    assert files[0].file_name == "test.py"


@pytest.mark.asyncio
async def test_save_metadata_update(temp_workspace, db_session):
    """测试更新已存在的元数据"""
    organizer = FileOrganizer(db_session)
    
    test_file = temp_workspace / "test.py"
    test_file.write_text("print('hello')")
    
    # 第一次保存
    metadata1 = await organizer.create_file_metadata(test_file)
    saved1 = await organizer.save_metadata(metadata1)
    
    # 修改文件
    test_file.write_text("print('world')")
    
    # 第二次保存
    metadata2 = await organizer.create_file_metadata(test_file)
    saved2 = await organizer.save_metadata(metadata2)
    
    # 应该是同一条记录
    assert saved1.id == saved2.id
    
    # 数据库中应该只有一条记录
    files = await organizer.search_files()
    assert len(files) == 1


@pytest.mark.asyncio
async def test_organize_file(temp_workspace, db_session):
    """测试文件归档"""
    organizer = FileOrganizer(db_session)
    
    # 创建源文件
    source_file = temp_workspace / "test.py"
    source_file.write_text("print('hello')")
    
    # 创建目标目录
    target_dir = temp_workspace / "organized"
    target_dir.mkdir()
    
    # 归档文件
    metadata = await organizer.organize_file(source_file, target_dir)
    
    # 验证文件已移动
    assert not source_file.exists()
    assert (target_dir / "code" / "test.py").exists()
    
    # 验证元数据
    assert metadata.file_name == "test.py"
    assert metadata.category == "code"
    assert metadata.file_path == str(target_dir / "code" / "test.py")


@pytest.mark.asyncio
async def test_organize_file_with_custom_category(temp_workspace, db_session):
    """测试使用自定义分类归档文件"""
    organizer = FileOrganizer(db_session)
    
    # 创建源文件
    source_file = temp_workspace / "test.py"
    source_file.write_text("print('hello')")
    
    # 创建目标目录
    target_dir = temp_workspace / "organized"
    target_dir.mkdir()
    
    # 使用自定义分类归档
    metadata = await organizer.organize_file(source_file, target_dir, category="custom")
    
    # 验证文件已移动到自定义分类目录
    assert (target_dir / "custom" / "test.py").exists()
    assert metadata.category == "custom"


@pytest.mark.asyncio
async def test_organize_file_with_conflict(temp_workspace, db_session):
    """测试文件归档时的文件名冲突处理"""
    organizer = FileOrganizer(db_session)
    
    # 创建源文件
    source_file = temp_workspace / "test.py"
    source_file.write_text("print('hello')")
    
    # 创建目标目录和已存在的文件
    target_dir = temp_workspace / "organized"
    target_dir.mkdir()
    code_dir = target_dir / "code"
    code_dir.mkdir()
    (code_dir / "test.py").write_text("existing")
    
    # 归档文件
    metadata = await organizer.organize_file(source_file, target_dir)
    
    # 验证文件已重命名
    assert (code_dir / "test_1.py").exists()
    assert metadata.file_name == "test_1.py"


@pytest.mark.asyncio
async def test_search_files(temp_workspace, db_session):
    """测试搜索文件"""
    organizer = FileOrganizer(db_session)
    
    # 创建测试文件
    (temp_workspace / "test1.py").write_text("print('hello')")
    (temp_workspace / "test2.md").write_text("# Test")
    (temp_workspace / "test3.json").write_text("{}")
    
    # 扫描并保存
    files = await organizer.scan_directory(temp_workspace)
    for f in files:
        await organizer.save_metadata(f)
    
    # 搜索所有文件
    all_files = await organizer.search_files()
    assert len(all_files) == 3
    
    # 按关键词搜索
    py_files = await organizer.search_files(keyword="test1")
    assert len(py_files) == 1
    assert py_files[0].file_name == "test1.py"
    
    # 按分类搜索
    code_files = await organizer.search_files(category="code")
    assert len(code_files) == 1
    assert code_files[0].file_name == "test1.py"
    
    # 按文件类型搜索
    md_files = await organizer.search_files(file_type=".md")
    assert len(md_files) == 1
    assert md_files[0].file_name == "test2.md"


@pytest.mark.asyncio
async def test_search_files_with_limit(temp_workspace, db_session):
    """测试搜索文件时的限制"""
    organizer = FileOrganizer(db_session)
    
    # 创建多个测试文件
    for i in range(10):
        (temp_workspace / f"test{i}.py").write_text(f"print({i})")
    
    # 扫描并保存
    files = await organizer.scan_directory(temp_workspace)
    for f in files:
        await organizer.save_metadata(f)
    
    # 限制返回数量
    limited_files = await organizer.search_files(limit=5)
    assert len(limited_files) == 5


@pytest.mark.asyncio
async def test_scan_nonexistent_directory(temp_workspace, db_session):
    """测试扫描不存在的目录"""
    organizer = FileOrganizer(db_session)
    
    nonexistent = temp_workspace / "nonexistent"
    
    with pytest.raises(ValueError, match="目录不存在"):
        await organizer.scan_directory(nonexistent)


@pytest.mark.asyncio
async def test_create_metadata_nonexistent_file(temp_workspace, db_session):
    """测试创建不存在文件的元数据"""
    organizer = FileOrganizer(db_session)
    
    nonexistent = temp_workspace / "nonexistent.py"
    
    with pytest.raises(ValueError, match="文件不存在"):
        await organizer.create_file_metadata(nonexistent)


@pytest.mark.asyncio
async def test_organize_nonexistent_file(temp_workspace, db_session):
    """测试归档不存在的文件"""
    organizer = FileOrganizer(db_session)
    
    nonexistent = temp_workspace / "nonexistent.py"
    target_dir = temp_workspace / "organized"
    target_dir.mkdir()
    
    with pytest.raises(ValueError, match="源文件不存在"):
        await organizer.organize_file(nonexistent, target_dir)
