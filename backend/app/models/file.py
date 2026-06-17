from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class FileMetadata(Base):
    """文件元数据"""
    __tablename__ = "file_metadata"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    file_path: Mapped[str] = mapped_column(String(500), unique=True, index=True)
    file_name: Mapped[str] = mapped_column(String(255), index=True)
    file_type: Mapped[str] = mapped_column(String(50))  # 文件扩展名
    category: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)  # 分类
    tags: Mapped[Optional[str]] = mapped_column(Text, nullable=True)  # JSON 格式标签
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    project_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    is_archived: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc)
    )
    
    def __repr__(self) -> str:
        return f"<FileMetadata(id={self.id}, file_name='{self.file_name}')>"
