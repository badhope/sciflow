"""插件管理 API"""
from typing import List

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.plugins.manager import plugin_manager
from app.utils.logger import logger

router = APIRouter(prefix="/plugins", tags=["plugins"])


class PluginResponse(BaseModel):
    """插件响应"""
    name: str
    status: str


class LoadPluginRequest(BaseModel):
    """加载插件请求"""
    name: str
    module_path: str


@router.get("/", response_model=List[PluginResponse])
async def list_plugins():
    """获取所有已加载的插件列表"""
    plugins = plugin_manager.list_plugins()
    return [
        PluginResponse(name=name, status="loaded")
        for name in plugins
    ]


@router.post("/load")
async def load_plugin(request: LoadPluginRequest):
    """加载插件"""
    try:
        import importlib.util
        import sys
        
        # 动态加载模块
        spec = importlib.util.spec_from_file_location(
            request.name, 
            request.module_path
        )
        if spec is None or spec.loader is None:
            raise ValueError(f"无法加载模块: {request.module_path}")
        
        module = importlib.util.module_from_spec(spec)
        sys.modules[request.name] = module
        spec.loader.exec_module(module)
        
        # 加载插件
        plugin_manager.load_plugin(request.name, module)
        
        return {
            "status": "success",
            "message": f"插件 {request.name} 加载成功"
        }
    except Exception as e:
        logger.error(f"加载插件失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/unload/{plugin_name}")
async def unload_plugin(plugin_name: str):
    """卸载插件"""
    try:
        plugin_manager.unload_plugin(plugin_name)
        return {
            "status": "success",
            "message": f"插件 {plugin_name} 已卸载"
        }
    except Exception as e:
        logger.error(f"卸载插件失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/discover")
async def discover_plugins():
    """发现并加载所有插件"""
    try:
        plugin_manager.discover_plugins()
        plugins = plugin_manager.list_plugins()
        return {
            "status": "success",
            "message": f"发现 {len(plugins)} 个插件",
            "plugins": plugins
        }
    except Exception as e:
        logger.error(f"发现插件失败: {e}")
        raise HTTPException(status_code=400, detail=str(e))
