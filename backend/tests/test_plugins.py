"""插件系统测试"""
import pytest
import tempfile
from pathlib import Path
from app.plugins.manager import PluginManager
from app.plugins.hookspecs import hookimpl


class TestPlugin:
    """测试插件"""
    
    def __init__(self):
        self.events = []
    
    @hookimpl
    def on_file_created(self, file_path: str, metadata: dict):
        self.events.append(("file_created", file_path))
    
    @hookimpl
    def on_git_commit(self, repo_path: str, commit_hash: str, message: str):
        self.events.append(("git_commit", commit_hash))


@pytest.fixture
def temp_plugins_dir():
    """创建临时插件目录"""
    with tempfile.TemporaryDirectory() as tmpdir:
        yield Path(tmpdir)


def test_plugin_manager_init(temp_plugins_dir):
    """测试插件管理器初始化"""
    manager = PluginManager(temp_plugins_dir)
    assert manager.plugins_dir == temp_plugins_dir
    assert len(manager.list_plugins()) == 0


def test_register_plugin(temp_plugins_dir):
    """测试注册插件"""
    manager = PluginManager(temp_plugins_dir)
    plugin = TestPlugin()
    
    manager.load_plugin("test_plugin", plugin)
    
    assert "test_plugin" in manager.list_plugins()


def test_unregister_plugin(temp_plugins_dir):
    """测试卸载插件"""
    manager = PluginManager(temp_plugins_dir)
    plugin = TestPlugin()
    
    manager.load_plugin("test_plugin", plugin)
    manager.unload_plugin("test_plugin")
    
    assert "test_plugin" not in manager.list_plugins()


def test_call_hook(temp_plugins_dir):
    """测试调用钩子"""
    manager = PluginManager(temp_plugins_dir)
    plugin = TestPlugin()
    
    manager.load_plugin("test_plugin", plugin)
    
    # 调用钩子
    manager.call_hook("on_file_created", file_path="/test/file.py", metadata={})
    
    assert len(plugin.events) == 1
    assert plugin.events[0] == ("file_created", "/test/file.py")


def test_call_multiple_hooks(temp_plugins_dir):
    """测试调用多个钩子"""
    manager = PluginManager(temp_plugins_dir)
    plugin = TestPlugin()
    
    manager.load_plugin("test_plugin", plugin)
    
    manager.call_hook("on_file_created", file_path="/test/file1.py", metadata={})
    manager.call_hook("on_file_created", file_path="/test/file2.py", metadata={})
    manager.call_hook("on_git_commit", repo_path="/repo", commit_hash="abc123", message="test")
    
    assert len(plugin.events) == 3


def test_discover_plugins(temp_plugins_dir):
    """测试发现插件"""
    # 创建一个插件文件
    plugin_code = '''
from app.plugins.hookspecs import hookimpl

class AutoPlugin:
    @hookimpl
    def on_file_created(self, file_path: str, metadata: dict):
        pass
'''
    plugin_file = temp_plugins_dir / "auto_plugin.py"
    plugin_file.write_text(plugin_code)
    
    manager = PluginManager(temp_plugins_dir)
    manager.discover_plugins()
    
    assert "auto_plugin" in manager.list_plugins()


def test_discover_nonexistent_directory():
    """测试发现不存在的插件目录"""
    nonexistent = Path("/nonexistent/plugins")
    manager = PluginManager(nonexistent)
    
    # 不应该抛出异常
    manager.discover_plugins()
    assert len(manager.list_plugins()) == 0


def test_call_hook_no_plugins(temp_plugins_dir):
    """测试没有插件时调用钩子"""
    manager = PluginManager(temp_plugins_dir)
    
    # 不应该抛出异常
    manager.call_hook("on_file_created", file_path="/test.py", metadata={})


def test_multiple_plugins(temp_plugins_dir):
    """测试多个插件"""
    manager = PluginManager(temp_plugins_dir)
    plugin1 = TestPlugin()
    plugin2 = TestPlugin()
    
    manager.load_plugin("plugin1", plugin1)
    manager.load_plugin("plugin2", plugin2)
    
    manager.call_hook("on_file_created", file_path="/test.py", metadata={})
    
    # 两个插件都应该收到事件
    assert len(plugin1.events) == 1
    assert len(plugin2.events) == 1


def test_plugin_error_handling(temp_plugins_dir):
    """测试插件错误处理"""
    
    class ErrorPlugin:
        @hookimpl
        def on_file_created(self, file_path: str, metadata: dict):
            raise ValueError("Test error")
    
    manager = PluginManager(temp_plugins_dir)
    plugin = ErrorPlugin()
    manager.load_plugin("error_plugin", plugin)
    
    # 应该捕获异常但不中断
    with pytest.raises(ValueError, match="Test error"):
        manager.call_hook("on_file_created", file_path="/test.py", metadata={})
