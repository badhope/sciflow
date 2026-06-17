"""大模型统一调度模块"""
from typing import AsyncIterator, Dict, List, Optional

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage

from app.config import settings
from app.utils.logger import logger
from app.utils.validator import validate_model_config


class LLMManager:
    """大模型统一管理器"""
    
    def __init__(self):
        self._llm: Optional[BaseChatModel] = None
        self._provider: Optional[str] = None
        self._model: Optional[str] = None
    
    def _create_openai_llm(self) -> BaseChatModel:
        """创建 OpenAI 模型"""
        from langchain_openai import ChatOpenAI
        
        if not settings.openai_api_key:
            raise ValueError("OpenAI API Key 未配置")
        
        return ChatOpenAI(
            model=settings.openai_model,
            api_key=settings.openai_api_key,
            base_url=settings.openai_base_url,
            temperature=0.7,
            max_tokens=2000,
        )
    
    def _create_ollama_llm(self) -> BaseChatModel:
        """创建 Ollama 模型"""
        from langchain_community.chat_models import ChatOllama
        
        return ChatOllama(
            model=settings.ollama_model,
            base_url=settings.ollama_base_url,
            temperature=0.7,
            num_predict=2000,
        )
    
    def get_llm(self) -> BaseChatModel:
        """获取大模型实例"""
        current_model = (
            settings.openai_model if settings.llm_provider == "openai"
            else settings.ollama_model
        )
        validate_model_config(settings.llm_provider, current_model)
        
        # 如果配置没变，返回缓存的实例
        if (self._llm and 
            self._provider == settings.llm_provider and 
            self._model == current_model):
            return self._llm
        
        # 创建新实例
        if settings.llm_provider == "openai":
            self._llm = self._create_openai_llm()
        elif settings.llm_provider == "ollama":
            self._llm = self._create_ollama_llm()
        else:
            raise ValueError(f"不支持的模型提供商: {settings.llm_provider}")
        
        self._provider = settings.llm_provider
        self._model = current_model
        
        logger.info(f"已切换到大模型: {self._provider}/{self._model}")
        return self._llm
    
    def _convert_messages(self, messages: List[Dict[str, str]]) -> List[BaseMessage]:
        """转换消息格式为 LangChain 格式"""
        converted = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            
            if role == "user":
                converted.append(HumanMessage(content=content))
            elif role == "assistant":
                converted.append(AIMessage(content=content))
            elif role == "system":
                converted.append(SystemMessage(content=content))
            else:
                converted.append(HumanMessage(content=content))
        
        return converted
    
    async def chat(self, messages: List[Dict[str, str]], **kwargs) -> str:
        """同步对话"""
        llm = self.get_llm()
        converted_messages = self._convert_messages(messages)
        
        try:
            response = await llm.ainvoke(converted_messages, **kwargs)
            return response.content
        except Exception as e:
            logger.error(f"大模型调用失败: {e}")
            raise
    
    async def stream_chat(
        self, messages: List[Dict[str, str]], **kwargs
    ) -> AsyncIterator[str]:
        """流式对话"""
        llm = self.get_llm()
        converted_messages = self._convert_messages(messages)
        
        try:
            async for chunk in llm.astream(converted_messages, **kwargs):
                yield chunk.content
        except Exception as e:
            logger.error(f"大模型流式调用失败: {e}")
            raise


# 全局实例
llm_manager = LLMManager()
