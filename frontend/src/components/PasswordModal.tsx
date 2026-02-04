import React, { useState } from "react";
import styled from "styled-components";
import {
  getAuth,
  updatePassword,
  EmailAuthProvider,
  reauthenticateWithCredential,
} from "firebase/auth";
import { useAuth } from "../context/AuthContext";

export default function PasswordModal({ onClose }: { onClose: () => void }) {
  const auth = getAuth();
  const { user } = useAuth();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (!current || !next || !confirm) return setErr("Please fill all fields.");
    if (next !== confirm) return setErr("Passwords do not match.");

    try {
      setLoading(true);
      const credential = EmailAuthProvider.credential(user!.email!, current);
      await reauthenticateWithCredential(auth.currentUser!, credential);
      await updatePassword(auth.currentUser!, next);
      setSuccess(true);
      setTimeout(() => onClose(), 1500);
    } catch (ex: any) {
      setErr(ex?.message || "Failed to update password.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Overlay onClick={onClose}>
      <Card onClick={(e) => e.stopPropagation()}>
        <Title>Change Password</Title>
        <Form onSubmit={submit}>
          <Input
            placeholder="Current Password"
            type="password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
            required
          />
          <Input
            placeholder="New Password"
            type="password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
            required
          />
          <Input
            placeholder="Confirm New Password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
          />

          {err && <ErrorMessage>{err}</ErrorMessage>}
          {success && <SuccessMessage>Password updated successfully!</SuccessMessage>}

          <SubmitButton type="submit" disabled={loading}>
            {loading ? "Updating..." : "Save Changes"}
          </SubmitButton>
        </Form>

        <CancelButton onClick={onClose}>Cancel</CancelButton>
      </Card>
    </Overlay>
  );
}

/* ===== 样式完全复用 Login 风格 ===== */
const Overlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  backdrop-filter: blur(4px);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
`;

const Card = styled.div`
  background: ${({ theme }) => theme.colors.card};
  border-radius: ${({ theme }) => theme.radius.lg};
  box-shadow: ${({ theme }) => theme.shadow.soft};
  padding: 40px;
  width: 400px;

  @media (max-width: 768px) {
    padding: 32px 24px;
    width: 90%;
  }
`;

const Title = styled.h2`
  margin: 0 0 24px 0;
  font-size: 26px;
  font-weight: 800;
  color: ${({ theme }) => theme.colors.text};
  text-align: center;
`;

const Form = styled.form`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

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
`;

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
`;

const CancelButton = styled.button`
  margin-top: 16px;
  padding: 14px 20px;
  width: 100%;
  background: ${({ theme }) => theme.colors.white};
  border: none;
  border-radius: ${({ theme }) => theme.radius.btn};
  color: ${({ theme }) => theme.colors.muted};
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  &:hover {
    opacity: 0.7;
  }
`;

const ErrorMessage = styled.div`
  color: #d32f2f;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 12px;
  background: #d32f2f15;
  border-radius: ${({ theme }) => theme.radius.md};
`;

const SuccessMessage = styled.div`
  color: #2e7d32;
  font-size: 14px;
  font-weight: 600;
  padding: 10px 12px;
  background: #4caf5015;
  border-radius: ${({ theme }) => theme.radius.md};
`;