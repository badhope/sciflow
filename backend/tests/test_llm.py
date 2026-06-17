"""大模型模块测试"""
import pytest
from unittest.mock import Mock, patch, AsyncMock
from app.core.llm import LLMManager
from app.core.context import ConversationContext


def test_context_add_message():
    """测试上下文添加消息"""
    ctx = ConversationContext(session_id="test")
    ctx.add_message("user", "hello")
    ctx.add_message("assistant", "hi")
    
    assert len(ctx.messages) == 2
    assert ctx.messages[0].role == "user"
    assert ctx.messages[1].content == "hi"


def test_context_max_history():
    """测试上下文历史长度限制"""
    ctx = ConversationContext(session_id="test", max_history=3)
    
    for i in range(5):
        ctx.add_message("user", f"msg {i}")
    
    assert len(ctx.messages) == 3
    assert ctx.messages[0].content == "msg 2"


def test_context_get_messages_for_llm():
    """测试获取 LLM 格式消息"""
    ctx = ConversationContext(session_id="test")
    ctx.add_message("system", "You are a helpful assistant")
    ctx.add_message("user", "hello")
    
    messages = ctx.get_messages_for_llm()
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"


def test_context_clear():
    """测试清空上下文"""
    ctx = ConversationContext(session_id="test")
    ctx.add_message("user", "hello")
    ctx.clear()
    
    assert len(ctx.messages) == 0


@pytest.mark.asyncio
async def test_llm_chat():
    """测试对话功能"""
    manager = LLMManager()
    
    # Mock 掉实际的 LLM 调用
    with patch.object(manager, 'get_llm') as mock_get_llm:
        mock_llm = AsyncMock()
        mock_response = Mock()
        mock_response.content = "test response"
        mock_llm.ainvoke.return_value = mock_response
        mock_get_llm.return_value = mock_llm
        
        result = await manager.chat([{"role": "user", "content": "hello"}])
        assert result == "test response"


def test_convert_messages():
    """测试消息格式转换"""
    manager = LLMManager()
    
    messages = [
        {"role": "system", "content": "You are helpful"},
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"}
    ]
    
    converted = manager._convert_messages(messages)
    assert len(converted) == 3
    assert converted[0].__class__.__name__ == "SystemMessage"
    assert converted[1].__class__.__name__ == "HumanMessage"
    assert converted[2].__class__.__name__ == "AIMessage"
