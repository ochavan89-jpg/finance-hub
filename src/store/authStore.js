import { create } from 'zustand'
import { REFRESH_KEY, TOKEN_KEY, USER_KEY } from '../services/machineosApi.js'

export const useAuthStore = create((set) => ({
  user: null,
  token: null,
  refreshToken: null,
  loading: true,

  initAuth: () => {
    const token = localStorage.getItem(TOKEN_KEY)
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    let user = null
    try {
      user = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
    } catch {
      user = null
    }
    set({
      user: token ? user : null,
      token: token || null,
      refreshToken: refreshToken || null,
      loading: false,
    })
  },

  login: (response) => {
    const { token, refreshToken, user } = response
    localStorage.setItem(TOKEN_KEY, token)
    if (refreshToken) {
      localStorage.setItem(REFRESH_KEY, refreshToken)
    }
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user))
    }
    set({
      user: user || null,
      token,
      refreshToken: refreshToken || null,
      loading: false,
    })
  },

  signOut: async () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    set({ user: null, token: null, refreshToken: null })
  },
}))
