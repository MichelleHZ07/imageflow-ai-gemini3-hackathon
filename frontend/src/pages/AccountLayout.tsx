import React from "react";
import { Outlet } from "react-router-dom";
import styled from "styled-components";

export default function AccountLayout() {
  return (
    <Page>
      <Container>
        <Outlet />
      </Container>
    </Page>
  );
}

/* ============ Styles ============ */

const Page = styled.div`
  background: ${({ theme }) => theme.colors.bg};
  min-height: calc(100vh - 80px);
  padding: 40px 24px;
`;

const Container = styled.div`
  max-width: 1200px;
  margin: 0 auto;
`;