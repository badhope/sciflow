import React from 'react';
import { Layout, Typography, Card, List, Tag } from 'antd';

const { Header, Content } = Layout;
const { Title } = Typography;

const Plugins: React.FC = () => {
  const plugins = [
    { name: '示例插件', version: '0.1.0', status: 'active' },
    { name: '代码分析插件', version: '0.1.0', status: 'inactive' },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px' }}>
        <Title level={3} style={{ margin: '16px 0' }}>插件管理</Title>
      </Header>
      <Content style={{ padding: '24px', background: '#f0f2f5' }}>
        <List
          grid={{ gutter: 16, column: 3 }}
          dataSource={plugins}
          renderItem={(item) => (
            <List.Item>
              <Card
                title={item.name}
                extra={<Tag color={item.status === 'active' ? 'green' : 'default'}>{item.status}</Tag>}
              >
                <p>版本: {item.version}</p>
              </Card>
            </List.Item>
          )}
        />
      </Content>
    </Layout>
  );
};

export default Plugins;
