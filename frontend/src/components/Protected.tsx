import React from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function Protected({children}:{children:React.ReactNode}){
  const { user, loading } = useAuth()
  const loc = useLocation()
  if(loading) return <div className="container">Loading…</div>
  // If auth not configured, allow access for demo
  if(user===null && !('VITE_FIREBASE_API_KEY' in import.meta.env)) return <>{children}</>
  if(!user) return <Navigate to="/login" state={{ redirect: loc.pathname }} replace />
  return <>{children}</>
}
