"""对话上下文管理"""
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List


@dataclass
class Message:
    """消息"""
    role: str  # user, assistant, system
    content: str
    timestamp: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class ConversationContext:
    """对话上下文"""
    session_id: str
    messages: List[Message] = field(default_factory=list)
    max_history: int = 20
    
    def add_message(self, role: str, content: str, **metadata):
        """添加消息"""
        msg = Message(role=role, content=content, metadata=metadata)
        self.messages.append(msg)
        
        # 保持历史长度
        if len(self.messages) > self.max_history:
            self.messages = self.messages[-self.max_history:]
    
    def get_messages_for_llm(self) -> List[Dict[str, str]]:
        """获取发送给 LLM 的消息格式"""
        return [
            {"role": msg.role, "content": msg.content}
            for msg in self.messages
        ]
    
    def clear(self):
        """清空上下文"""
        self.messages.clear()
