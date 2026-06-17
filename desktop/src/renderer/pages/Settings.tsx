import React from 'react';
import { Layout, Typography, Form, Input, Select, Button } from 'antd';

const { Header, Content } = Layout;
const { Title } = Typography;

const Settings: React.FC = () => {
  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Header style={{ background: '#fff', padding: '0 24px' }}>
        <Title level={3} style={{ margin: '16px 0' }}>设置</Title>
      </Header>
      <Content style={{ padding: '24px', background: '#f0f2f5' }}>
        <Form layout="vertical" style={{ maxWidth: 600 }}>
          <Form.Item label="大模型提供商">
            <Select defaultValue="openai">
              <Select.Option value="openai">OpenAI</Select.Option>
              <Select.Option value="ollama">Ollama (本地)</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item label="API Key">
            <Input.Password placeholder="输入 API Key" />
          </Form.Item>
          <Form.Item label="模型名称">
            <Input placeholder="例如: gpt-4-turbo-preview" />
          </Form.Item>
          <Form.Item>
            <Button type="primary">保存设置</Button>
          </Form.Item>
        </Form>
      </Content>
    </Layout>
  );
};

export default Settings;
