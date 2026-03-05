import { createContext, useCallback, useContext, useState } from 'react'
import { inviteMember, resendMemberInvite, updateProfile } from '../api/memberApi'

const MemberContext = createContext(null)

export function MemberProvider({ children }) {
  const [profile, setProfile] = useState(null)
  const [members, setMembers] = useState([])

  const loadProfile = useCallback((data) => setProfile(data), [])
  const loadMembers = useCallback((data) => setMembers(data), [])

  const handleSaveProfile = useCallback(async (nextProfile) => {
    const updated = await updateProfile(nextProfile)
    setProfile(updated)
    return updated
  }, [])

  const handleInviteMember = useCallback(async (payload) => {
    const created = await inviteMember(payload)
    setMembers((current) => [...current, created])
    return created
  }, [])

  const handleResendInvite = useCallback(async (memberId) => {
    await resendMemberInvite(memberId)
  }, [])

  return (
    <MemberContext.Provider value={{ profile, members, loadProfile, loadMembers, handleSaveProfile, handleInviteMember, handleResendInvite }}>
      {children}
    </MemberContext.Provider>
  )
}

export function useMembers() {
  const context = useContext(MemberContext)
  if (!context) throw new Error('useMembers must be used within MemberProvider')
  return context
}
