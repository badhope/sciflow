from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import JSON, DateTime, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class OperationLog(Base):
    """操作记录"""
    __tablename__ = "operation_logs"
    
    id: Mapped[int] = mapped_column(primary_key=True)
    operation_type: Mapped[str] = mapped_column(
        String(50), index=True
    )  # git_clone, file_move, etc.
    target_path: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)
    status: Mapped[str] = mapped_column(String(20))  # success, failed, pending
    details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    
    def __repr__(self) -> str:
        return (
            f"<OperationLog(id={self.id}, type='{self.operation_type}', "
            f"status='{self.status}')>"
        )
