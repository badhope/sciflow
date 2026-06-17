"""插件管理器"""
import importlib
import sys
from pathlib import Path
from typing import Any, Dict, List

import pluggy

from app.config import settings
from app.plugins.hookspecs import PluginHookSpec
from app.utils.logger import logger


class PluginManager:
    """插件管理器"""
    
    def __init__(self, plugins_dir: Path):
        self.plugins_dir = plugins_dir
        self.pm = pluggy.PluginManager("ai_dev_assistant")
        self.pm.add_hookspecs(PluginHookSpec)
        self._loaded_plugins: Dict[str, Any] = {}
    
    def discover_plugins(self):
        """发现并加载插件"""
        if not self.plugins_dir.exists():
            logger.warning(f"插件目录不存在: {self.plugins_dir}")
            return
        
        # 添加插件目录到 Python 路径
        sys.path.insert(0, str(self.plugins_dir))
        
        # 扫描 Python 文件
        for plugin_file in self.plugins_dir.glob("*.py"):
            if plugin_file.name.startswith("_"):
                continue
            
            module_name = plugin_file.stem
            try:
                module = importlib.import_module(module_name)
                self.load_plugin(module_name, module)
            except Exception as e:
                logger.error(f"加载插件失败 {module_name}: {e}")
    
    def load_plugin(self, name: str, plugin_or_module: Any):
        """加载单个插件（支持传入插件实例或模块）"""
        import types
        
        # 如果传入的是模块，查找其中的插件类
        if isinstance(plugin_or_module, types.ModuleType):
            plugin_instance = None
            for attr_name in dir(plugin_or_module):
                attr = getattr(plugin_or_module, attr_name)
                if isinstance(attr, type) and hasattr(attr, 'on_file_created'):
                    plugin_instance = attr()
                    break
            
            if not plugin_instance:
                logger.warning(f"模块 {name} 没有有效的钩子实现")
                return
            
            self.pm.register(plugin_instance, name=name)
            self._loaded_plugins[name] = plugin_instance
            logger.info(f"插件加载成功: {name}")
        else:
            # 直接注册插件实例
            self.pm.register(plugin_or_module, name=name)
            self._loaded_plugins[name] = plugin_or_module
            logger.info(f"插件加载成功: {name}")
    
    def unload_plugin(self, name: str):
        """卸载插件"""
        if name in self._loaded_plugins:
            self.pm.unregister(self._loaded_plugins[name])
            del self._loaded_plugins[name]
            logger.info(f"插件已卸载: {name}")
    
    def list_plugins(self) -> List[str]:
        """列出所有已加载的插件"""
        return list(self._loaded_plugins.keys())
    
    def call_hook(self, hook_name: str, **kwargs):
        """调用插件钩子"""
        hook = getattr(self.pm.hook, hook_name)
        return hook(**kwargs)


# 全局实例
plugin_manager = PluginManager(settings.plugins_dir)
