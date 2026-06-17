"""插件钩子规范定义"""
import pluggy

# 创建 hookspec 标记器
hookspec = pluggy.HookspecMarker("ai_dev_assistant")

# 创建 hook 实现器标记
hookimpl = pluggy.HookimplMarker("ai_dev_assistant")


class PluginHookSpec:
    """插件钩子规范定义"""
    
    @hookspec
    def on_file_created(self, file_path: str, metadata: dict):
        """文件创建时的钩子"""
        pass
    
    @hookspec
    def on_file_modified(self, file_path: str, metadata: dict):
        """文件修改时的钩子"""
        pass
    
    @hookspec
    def on_git_commit(self, repo_path: str, commit_hash: str, message: str):
        """Git 提交时的钩子"""
        pass
    
    @hookspec
    def on_llm_request(self, provider: str, model: str, messages: list):
        """大模型请求前的钩子"""
        pass
    
    @hookspec
    def on_llm_response(self, provider: str, model: str, response: str):
        """大模型响应后的钩子"""
        pass
    
    @hookspec
    def register_commands(self):
        """注册自定义命令"""
        pass
