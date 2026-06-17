"""文件自动归档管理器"""
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.file import FileMetadata
from app.utils.logger import logger
from app.utils.validator import validate_category, validate_file_path


class FileOrganizer:
    """文件自动归档管理器"""
    
    # 默认分类规则
    DEFAULT_CATEGORIES = {
        "code": [
            ".py", ".js", ".ts", ".jsx", ".tsx",
            ".java", ".cpp", ".c", ".go", ".rs"
        ],
        "document": [".md", ".txt", ".doc", ".docx", ".pdf", ".rst"],
        "data": [".json", ".xml", ".yaml", ".yml", ".csv", ".sql"],
        "image": [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp"],
        "config": [".env", ".toml", ".ini", ".cfg", ".conf"],
        "archive": [".zip", ".tar", ".gz", ".rar", ".7z"],
    }
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    def classify_file(self, file_path: Path) -> str:
        """根据文件扩展名自动分类"""
        ext = file_path.suffix.lower()
        
        for category, extensions in self.DEFAULT_CATEGORIES.items():
            if ext in extensions:
                return category
        
        return "other"
    
    async def scan_directory(
        self, directory: Path, recursive: bool = True
    ) -> List[FileMetadata]:
        """扫描目录，创建文件元数据"""
        dir_path = validate_file_path(str(directory))
        
        if not dir_path.exists():
            raise ValueError(f"目录不存在: {dir_path}")
        
        files = []
        pattern = "**/*" if recursive else "*"
        
        for file_path in dir_path.glob(pattern):
            if file_path.is_file():
                metadata = await self.create_file_metadata(file_path)
                files.append(metadata)
        
        logger.info(f"扫描完成，找到 {len(files)} 个文件")
        return files
    
    async def create_file_metadata(self, file_path: Path) -> FileMetadata:
        """创建文件元数据"""
        path = validate_file_path(str(file_path))
        
        if not path.exists():
            raise ValueError(f"文件不存在: {path}")
        
        # 自动分类
        category = self.classify_file(path)
        
        # 获取文件信息
        stat = path.stat()
        
        metadata = FileMetadata(
            file_path=str(path),
            file_name=path.name,
            file_type=path.suffix.lower(),
            category=category,
            size_bytes=stat.st_size,
            created_at=datetime.fromtimestamp(stat.st_ctime, tz=timezone.utc),
            updated_at=datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc),
        )
        
        return metadata
    
    async def save_metadata(self, metadata: FileMetadata) -> FileMetadata:
        """保存文件元数据到数据库"""
        # 检查是否已存在
        stmt = select(FileMetadata).where(FileMetadata.file_path == metadata.file_path)
        result = await self.db.execute(stmt)
        existing = result.scalar_one_or_none()
        
        if existing:
            # 更新现有记录
            for key, value in metadata.__dict__.items():
                if key != '_sa_instance_state' and key != 'id':
                    setattr(existing, key, value)
            await self.db.flush()
            return existing
        else:
            # 创建新记录
            self.db.add(metadata)
            await self.db.flush()
            return metadata
    
    async def organize_file(
        self, source: Path, target_dir: Path, category: Optional[str] = None
    ) -> FileMetadata:
        """归档文件到目标目录"""
        source_path = validate_file_path(str(source))
        target_base = validate_file_path(str(target_dir))
        
        if not source_path.exists():
            raise ValueError(f"源文件不存在: {source_path}")
        
        # 确定分类
        if not category:
            category = self.classify_file(source_path)
        
        category = validate_category(category)
        
        # 创建分类目录
        category_dir = target_base / category
        category_dir.mkdir(parents=True, exist_ok=True)
        
        # 移动文件
        target_path = category_dir / source_path.name
        
        # 处理文件名冲突
        counter = 1
        original_target = target_path
        while target_path.exists():
            stem = original_target.stem
            suffix = original_target.suffix
            target_path = category_dir / f"{stem}_{counter}{suffix}"
            counter += 1
        
        import shutil
        shutil.move(str(source_path), str(target_path))
        logger.info(f"文件已归档: {source_path} -> {target_path}")
        
        # 创建并保存元数据
        metadata = await self.create_file_metadata(target_path)
        metadata.category = category
        return await self.save_metadata(metadata)
    
    async def search_files(
        self,
        keyword: Optional[str] = None,
        category: Optional[str] = None,
        file_type: Optional[str] = None,
        limit: int = 100
    ) -> List[FileMetadata]:
        """搜索文件"""
        stmt = select(FileMetadata)
        
        if keyword:
            stmt = stmt.where(FileMetadata.file_name.contains(keyword))
        
        if category:
            stmt = stmt.where(FileMetadata.category == category)
        
        if file_type:
            stmt = stmt.where(FileMetadata.file_type == file_type)
        
        stmt = stmt.limit(limit)
        
        result = await self.db.execute(stmt)
        return result.scalars().all()
