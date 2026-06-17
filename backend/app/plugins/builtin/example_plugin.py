"""示例插件"""
from app.plugins.hookspecs import hookimpl
from app.utils.logger import logger


class ExamplePlugin:
    """示例插件"""
    
    @hookimpl
    def on_file_created(self, file_path: str, metadata: dict):
        logger.info(f"[ExamplePlugin] 文件创建: {file_path}")
    
    @hookimpl
    def on_git_commit(self, repo_path: str, commit_hash: str, message: str):
        logger.info(f"[ExamplePlugin] Git 提交: {commit_hash[:8]} - {message}")
    
    @hookimpl
    def on_llm_request(self, provider: str, model: str, messages: list):
        logger.info(f"[ExamplePlugin] LLM 请求: {provider}/{model}")
