import React, { useEffect, useRef } from 'react';
import { Card } from 'antd';

interface AvatarProps {
  modelUrl?: string;
  isSpeaking?: boolean;
}

const Avatar: React.FC<AvatarProps> = ({ 
  modelUrl = 'https://models.readyplayer.me/65a8f3c8b8e3b0f6a7d4e5f6.glb',
  isSpeaking = false 
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 这里集成 Ready Player Me 的 WebGL 渲染器
    // 实际实现需要加载 3D 模型和动画
    console.log('Avatar component mounted', { modelUrl, isSpeaking });
    
    return () => {
      // 清理资源
    };
  }, [modelUrl, isSpeaking]);

  return (
    <Card 
      title="AI 助手" 
      style={{ width: 300, height: 400 }}
      bodyStyle={{ padding: 0, height: 350 }}
    >
      <div 
        ref={containerRef} 
        style={{ 
          width: '100%', 
          height: '100%', 
          background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          fontSize: 18
        }}
      >
        {isSpeaking ? '正在说话...' : 'AI 数字人'}
      </div>
    </Card>
  );
};

export default Avatar;
