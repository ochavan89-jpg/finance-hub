import { create } from 'zustand'
import { REFRESH_KEY, TOKEN_KEY, USER_KEY } from '../services/machineosApi.js'
import { isAccessTokenExpired } from '../lib/session.js'

export const useAuthStore = create((set, get) => ({
  user: null,
  token: null,
  refreshToken: null,
  loading: true,

  initAuth: async () => {
    const token = localStorage.getItem(TOKEN_KEY)
    const refreshToken = localStorage.getItem(REFRESH_KEY)
    let user = null
    try {
      user = JSON.parse(localStorage.getItem(USER_KEY) || 'null')
    } catch {
      user = null
    }

    if (!token) {
      set({
        user: null,
        token: null,
        refreshToken: refreshToken || null,
        loading: false,
      })
      return
    }

    if (!isAccessTokenExpired(token)) {
      set({
        user,
        token,
        refreshToken: refreshToken || null,
        loading: false,
      })
      return
    }

    try {
      const { refreshAccessToken } = await import('../services/machineosApi.js')
      const newToken = await refreshAccessToken()
      set({
        user,
        token: newToken,
        refreshToken: localStorage.getItem(REFRESH_KEY),
        loading: false,
      })
    } catch {
      await get().signOut()
      set({ loading: false })
    }
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

  updateAccessToken: (token) => {
    localStorage.setItem(TOKEN_KEY, token)
    set({ token })
  },

  signOut: async () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(REFRESH_KEY)
    localStorage.removeItem(USER_KEY)
    set({ user: null, token: null, refreshToken: null })
  },
}))
