"""API 集成测试"""
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession
from sqlalchemy.orm import sessionmaker
from app.database import Base, get_db
from app.main import app


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


@pytest_asyncio.fixture
async def client(db_session):
    """创建测试客户端"""
    async def override_get_db():
        yield db_session
    
    app.dependency_overrides[get_db] = override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        yield client
    app.dependency_overrides.clear()


@pytest.mark.asyncio
async def test_health_check(client):
    """测试健康检查接口"""
    response = await client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


@pytest.mark.asyncio
async def test_root(client):
    """测试根路径"""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "name" in data
    assert "version" in data
    assert data["status"] == "running"


@pytest.mark.asyncio
async def test_list_files_empty(client):
    """测试获取空文件列表"""
    response = await client.get("/api/v1/files/")
    assert response.status_code == 200
    assert response.json() == []


@pytest.mark.asyncio
async def test_git_status_invalid_path(client):
    """测试获取无效路径的 Git 状态"""
    response = await client.get("/api/v1/git/status/nonexistent")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_git_commits_invalid_path(client):
    """测试获取无效路径的提交记录"""
    response = await client.get("/api/v1/git/commits/nonexistent")
    assert response.status_code == 400


@pytest.mark.asyncio
async def test_file_not_found(client):
    """测试获取不存在的文件"""
    response = await client.get("/api/v1/files/99999")
    assert response.status_code == 404
    assert "文件不存在" in response.json()["detail"]


@pytest.mark.asyncio
async def test_delete_file_not_found(client):
    """测试删除不存在的文件"""
    response = await client.delete("/api/v1/files/99999")
    assert response.status_code == 404
    assert "文件不存在" in response.json()["detail"]
