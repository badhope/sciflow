import React from 'react';
import { Layout, Typography, Card } from 'antd';
import Avatar from '../components/Avatar';

const { Header, Content } = Layout;
const { Title } = Typography;

const Home: React.FC = () => {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px' }}>
        <Title level={3} style={{ margin: '16px 0' }}>AI 开发助手</Title>
      </Header>
      <Content style={{ padding: '24px', background: '#f0f2f5' }}>
        <Card title="欢迎使用 AI 开发助手">
          <p>这是一个智能化的开发助手，支持文件管理、Git 操作和插件扩展。</p>
        </Card>
        <div style={{ marginTop: 24, textAlign: 'center' }}>
          <Avatar />
        </div>
      </Content>
    </Layout>
  );
};

export default Home;
