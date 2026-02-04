import React, { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import styled from 'styled-components'

export default function Login() {
  const { login, register } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [registerMode, setRegisterMode] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const navigate = useNavigate()
  const location = useLocation()

  // ✅ 从 URL 参数读取 redirect（优先级高于 state）
  const params = new URLSearchParams(location.search)
  const redirect = params.get('redirect') || location.state?.redirect || '/app'

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr(null)
    try {
      if (registerMode) await register(email, password)
      else await login(email, password)
      // ✅ 登录成功后跳转回来源页（或默认 /app）
      navigate(redirect, { replace: true })
    } catch (ex: any) {
      setErr(ex?.message || 'Auth not configured.')
    }
  }

  return (
    <Page>
      <Container>
        <Card>
          <Title>{registerMode ? 'Create account' : 'Login'}</Title>
          <Form onSubmit={submit}>
            <Input
              placeholder="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <Input
              placeholder="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            {err && <ErrorMessage>{err}</ErrorMessage>}
            <SubmitButton type="submit">
              {registerMode ? 'Sign up' : 'Sign in'}
            </SubmitButton>
          </Form>
          <SwitchMode>
            {registerMode ? 'Already have an account? ' : 'No account? '}
            <SwitchButton
              type="button"
              onClick={() => setRegisterMode(!registerMode)}
            >
              {registerMode ? 'Login' : 'Create one'}
            </SwitchButton>
          </SwitchMode>
          {!('VITE_FIREBASE_API_KEY' in import.meta.env) && (
            <Notice>Auth not configured. Demo mode only.</Notice>
          )}
        </Card>
      </Container>
    </Page>
  )
}

/* ============ Styles ============ */

const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  min-height: calc(100vh - 80px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
`

const Container = styled.div`
  max-width: 440px;
  width: 100%;
`

const Card = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 40px;

  @media (max-width: 768px) {
    padding: 32px 24px;
  }
`

const Title = styled.h2`
  margin: 0 0 28px 0;
  font-size: 28px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  text-align: center;
`

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
`

const Input = styled.input`
  width: 100%;
  border: none;
  border-radius: ${({ theme }) => theme.radius.md};
  background: ${({ theme }) => theme.colors.inner};
  padding: 14px 16px;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.text};
  font-family: inherit;
  transition: all 0.2s ease;

  &::placeholder {
    color: ${({ theme }) => theme.colors.muted};
  }

  &:focus {
    outline: none;
    box-shadow: 0 0 0 2px ${({ theme }) => theme.colors.accent}40;
  }
`

const ErrorMessage = styled.div`
  color: #d32f2f;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 12px;
  background: #d32f2f15;
  border-radius: ${({ theme }) => theme.radius.md};
`

const SubmitButton = styled.button`
  background: ${({ theme }) => theme.colors.accent};
  color: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  padding: 14px 20px;
  font-weight: 700;
  font-size: 15px;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 8px;

  &:hover {
    opacity: 0.9;
  }
`

const SwitchMode = styled.div`
  margin-top: 20px;
  text-align: center;
  font-size: 14px;
  color: ${({ theme }) => theme.colors.text};
`

const SwitchButton = styled.button`
  background: transparent;
  border: none;
  color: ${({ theme }) => theme.colors.accent};
  font-weight: 700;
  cursor: pointer;
  padding: 0;
  font-size: 14px;
  text-decoration: underline;

  &:hover {
    opacity: 0.8;
  }
`

const Notice = styled.div`
  margin-top: 16px;
  padding: 12px;
  background: ${({ theme }) => theme.colors.inner};
  border-radius: ${({ theme }) => theme.radius.md};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.muted};
  text-align: center;
`