"""文件管理 API"""
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.file_organizer import FileOrganizer
from app.database import get_db
from app.models.file import FileMetadata
from app.utils.logger import logger

router = APIRouter(prefix="/files", tags=["files"])


class FileResponse(BaseModel):
    """文件响应模型"""
    id: int
    file_path: str
    file_name: str
    file_type: str
    category: Optional[str]
    tags: Optional[str]
    description: Optional[str]
    size_bytes: int
    created_at: str
    updated_at: str
    
    model_config = {"from_attributes": True}


class ScanRequest(BaseModel):
    directory: str
    recursive: bool = True


class OrganizeRequest(BaseModel):
    source: str
    target_dir: str
    category: Optional[str] = None


@router.get("/", response_model=List[FileResponse])
async def list_files(
    keyword: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    file_type: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db)
):
    """获取文件列表"""
    organizer = FileOrganizer(db)
    files = await organizer.search_files(
        keyword=keyword,
        category=category,
        file_type=file_type,
        limit=limit
    )
    return files


@router.post("/scan", response_model=List[FileResponse])
async def scan_directory(
    request: ScanRequest,
    db: AsyncSession = Depends(get_db)
):
    """扫描目录并导入文件元数据"""
    organizer = FileOrganizer(db)
    
    try:
        files = await organizer.scan_directory(
            Path(request.directory),
            recursive=request.recursive
        )
        
        # 保存到数据库
        saved_files = []
        for metadata in files:
            saved = await organizer.save_metadata(metadata)
            saved_files.append(saved)
        
        return saved_files
    except Exception as e:
        logger.error(f"扫描目录失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/organize", response_model=FileResponse)
async def organize_file(
    request: OrganizeRequest,
    db: AsyncSession = Depends(get_db)
):
    """归档文件"""
    organizer = FileOrganizer(db)
    
    try:
        metadata = await organizer.organize_file(
            Path(request.source),
            Path(request.target_dir),
            request.category
        )
        return metadata
    except Exception as e:
        logger.error(f"归档文件失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/{file_id}", response_model=FileResponse)
async def get_file(
    file_id: int,
    db: AsyncSession = Depends(get_db)
):
    """获取单个文件详情"""
    from sqlalchemy import select
    
    stmt = select(FileMetadata).where(FileMetadata.id == file_id)
    result = await db.execute(stmt)
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    return file


@router.delete("/{file_id}")
async def delete_file(
    file_id: int,
    db: AsyncSession = Depends(get_db)
):
    """删除文件记录（不删除实际文件）"""
    from sqlalchemy import delete, select
    
    stmt = select(FileMetadata).where(FileMetadata.id == file_id)
    result = await db.execute(stmt)
    file = result.scalar_one_or_none()
    
    if not file:
        raise HTTPException(status_code=404, detail="文件不存在")
    
    await db.execute(delete(FileMetadata).where(FileMetadata.id == file_id))
    return {"message": "删除成功"}
