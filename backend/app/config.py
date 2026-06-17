from pathlib import Path
from typing import Optional

from pydantic import ConfigDict, Field
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """应用配置"""
    
    model_config = ConfigDict(
        env_file=".env",
        env_file_encoding="utf-8"
    )
    
    # 应用基础配置
    app_name: str = "AI Dev Assistant"
    app_version: str = "0.1.0"
    debug: bool = False
    
    # API 服务配置
    api_host: str = "127.0.0.1"
    api_port: int = 8000
    
    # 数据库配置
    database_url: str = "sqlite+aiosqlite:///./data/assistant.db"
    
    # 大模型配置
    llm_provider: str = Field(default="openai", description="openai | ollama")
    openai_api_key: Optional[str] = None
    openai_base_url: Optional[str] = None
    openai_model: str = "gpt-4-turbo-preview"
    
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "llama2"
    
    # Git 配置
    git_workspace: Path = Field(default=Path("./workspace"))
    
    # 插件配置
    plugins_dir: Path = Field(default=Path("./plugins"))


settings = Settings()
