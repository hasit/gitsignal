import React, { useEffect, useRef, useState } from 'react'
import { startPolling, markAllRead, setToken, forceRefresh, markAsReadLocally } from './github'

const FILTER_STORAGE_KEY = 'gitsignal:filters'

const DEFAULT_FILTERS = {
  types: ['PullRequest'],
  reasons: ['review_requested']
}

function normalizeFilters(filters) {
  const types = Array.isArray(filters?.types) ? filters.types.filter(Boolean) : []
  const reasons = Array.isArray(filters?.reasons) ? filters.reasons.filter(Boolean) : []
  return { types, reasons }
}

function loadFiltersFromStorage() {
  try {
    const raw = localStorage.getItem(FILTER_STORAGE_KEY)
    if (!raw) return DEFAULT_FILTERS
    return normalizeFilters(JSON.parse(raw))
  } catch {
    return DEFAULT_FILTERS
  }
}

function getFilterOptions(notifications, filters) {
  const typeSet = new Set()
  const reasonSet = new Set()

  for (const notification of notifications || []) {
    if (notification?.subject?.type) typeSet.add(notification.subject.type)
    if (notification?.reason) reasonSet.add(notification.reason)
  }

  for (const type of filters?.types || []) {
    if (type) typeSet.add(type)
  }

  for (const reason of filters?.reasons || []) {
    if (reason) reasonSet.add(reason)
  }

  return {
    types: Array.from(typeSet).sort(),
    reasons: Array.from(reasonSet).sort()
  }
}

function matchesFilters(notification, filters) {
  const typeMatch = filters.types.length === 0 || filters.types.includes(notification.subject.type)
  const reasonMatch = filters.reasons.length === 0 || filters.reasons.includes(notification.reason)
  return typeMatch && reasonMatch
}

// Settings/Preferences component
function Settings({ onClose, onLogout, markAsReadOnClick, onMarkAsReadOnClickChange, filters, onFiltersChange, notifications }) {
  const [tokenInfo, setTokenInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [newToken, setNewToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [appSettings, setAppSettings] = useState(null)
  const [appSettingsLoading, setAppSettingsLoading] = useState(true)
  const [appSettingsSaving, setAppSettingsSaving] = useState(false)
  const [appSettingsError, setAppSettingsError] = useState(null)

  const filterOptions = getFilterOptions(notifications, filters)

  useEffect(() => {
    // Fetch current token info from GitHub
    async function fetchTokenInfo() {
      try {
        const token = await window.electron.auth.getToken()
        if (!token) {
          setLoading(false)
          return
        }

        // Validate token against Notifications API
        const response = await fetch('https://api.github.com/notifications?per_page=1', {
          headers: { 'Authorization': `token ${token}` }
        })

        if (response.ok) {
          // Get token scopes from headers
          const scopes = response.headers.get('X-OAuth-Scopes') || 'unknown'

          // Best-effort fetch of username
          let userLogin = null
          try {
            const userResponse = await fetch('https://api.github.com/user', {
              headers: { 'Authorization': `token ${token}` }
            })
            if (userResponse.ok) {
              const user = await userResponse.json()
              userLogin = user.login
            }
          } catch {
            // ignore
          }

          setTokenInfo({
            user: userLogin || 'unknown',
            scopes: scopes.split(', ').filter(Boolean),
            valid: true
          })
        } else {
          setTokenInfo({ valid: false })
        }
      } catch (err) {
        setTokenInfo({ valid: false, error: err.message })
      } finally {
        setLoading(false)
      }
    }

    fetchTokenInfo()
  }, [])

  useEffect(() => {
    async function fetchAppSettings() {
      try {
        if (!window.electron?.settings) return
        const settings = await window.electron.settings.get()
        setAppSettings(settings)
      } catch (err) {
        setAppSettingsError(err.message)
      } finally {
        setAppSettingsLoading(false)
      }
    }

    fetchAppSettings()
  }, [])

  const handleSaveToken = async (e) => {
    e.preventDefault()
    if (!newToken.trim()) return

    setSaving(true)
    setSaveError(null)

    try {
      // Validate token
      const response = await fetch('https://api.github.com/notifications?per_page=1', {
        headers: { 'Authorization': `token ${newToken.trim()}` }
      })

      if (!response.ok) {
        throw new Error('Invalid token')
      }

      // Save token
      await window.electron.auth.saveToken(newToken.trim())

      // Reload the app to use new token
      window.location.reload()
    } catch (err) {
      setSaveError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const isMac = window.electron?.platform === 'darwin'

  const saveAppSettings = async (updates) => {
    if (!window.electron?.settings) return

    setAppSettingsError(null)
    setAppSettingsSaving(true)
    try {
      if (appSettings) {
        setAppSettings({ ...appSettings, ...updates })
      }
      const saved = await window.electron.settings.set(updates)
      setAppSettings(saved)
    } catch (err) {
      setAppSettingsError(err.message)
    } finally {
      setAppSettingsSaving(false)
    }
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Settings</h2>
        <button onClick={onClose} style={{ padding: '6px 12px' }}>Close</button>
      </div>

      {/* Token Status */}
      <div style={{ marginBottom: 30 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>GitHub Token</h3>
        {loading ? (
          <p style={{ color: '#666', fontSize: 13 }}>Checking token...</p>
        ) : tokenInfo?.valid ? (
          <div style={{ padding: 15, background: '#d4edda', border: '1px solid #c3e6cb', borderRadius: 6 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              ✅ <strong>Token is valid</strong>
            </div>
            <div style={{ fontSize: 12, color: '#155724' }}>
              Authenticated as: <strong>{tokenInfo.user}</strong>
            </div>
            <div style={{ fontSize: 12, color: '#155724', marginTop: 4 }}>
              Scopes: {tokenInfo.scopes?.length > 0 ? tokenInfo.scopes.join(', ') : 'No scopes detected'}
            </div>
          </div>
        ) : (
          <div style={{ padding: 15, background: '#f8d7da', border: '1px solid #f5c6cb', borderRadius: 6 }}>
            <div style={{ fontSize: 13 }}>
              ❌ <strong>Token is invalid or expired</strong>
            </div>
          </div>
        )}

        {/* Update Token Form */}
        <form onSubmit={handleSaveToken} style={{ marginTop: 15 }}>
          <label style={{ display: 'block', fontSize: 13, marginBottom: 5, fontWeight: 500 }}>
            Update Token
          </label>
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
            style={{
              width: '100%',
              padding: '8px',
              fontSize: 13,
              fontFamily: 'monospace',
              border: '1px solid #ddd',
              borderRadius: 4,
              marginBottom: 8
            }}
          />
          {saveError && (
            <div style={{ color: 'red', fontSize: 12, marginBottom: 8 }}>{saveError}</div>
          )}
          <button
            type="submit"
            disabled={saving || !newToken.trim()}
            style={{ padding: '8px 16px', fontSize: 13 }}
          >
            {saving ? 'Saving...' : 'Update Token'}
          </button>
        </form>
      </div>

      {/* Behavior Settings */}
      <div style={{ marginBottom: 30 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>Behavior</h3>
        <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={markAsReadOnClick}
            onChange={(e) => onMarkAsReadOnClickChange(e.target.checked)}
            style={{ width: 16, height: 16, cursor: 'pointer' }}
          />
          <span style={{ fontSize: 13 }}>Mark as read when clicking notification</span>
        </label>
        <p style={{ fontSize: 12, color: '#666', marginTop: 6, marginLeft: 26 }}>
          When enabled, notifications will be automatically marked as read on GitHub when you click them.
        </p>
      </div>

      {/* Filters */}
      <div style={{ marginBottom: 30 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Filters</h3>
          <button
            onClick={() => onFiltersChange(DEFAULT_FILTERS)}
            style={{ padding: '6px 10px', fontSize: 12 }}
          >
            Reset to defaults
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#666', marginTop: 6 }}>
          Defaults show only PR review requests. Filters apply to what GitSignal displays.
        </p>

        <div style={{ display: 'grid', gap: 14, marginTop: 12 }}>
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Types</div>
            {filterOptions.types.length === 0 ? (
              <p style={{ color: '#666', fontSize: 12, margin: 0 }}>
                No notification types available yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {filterOptions.types.map((type) => (
                  <label key={type} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={filters.types.includes(type)}
                      onChange={(e) => {
                        const nextTypes = e.target.checked
                          ? [...filters.types, type]
                          : filters.types.filter(t => t !== type)
                        onFiltersChange({ ...filters, types: nextTypes })
                      }}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 13 }}>{type}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Reasons</div>
            {filterOptions.reasons.length === 0 ? (
              <p style={{ color: '#666', fontSize: 12, margin: 0 }}>
                No notification reasons available yet.
              </p>
            ) : (
              <div style={{ display: 'grid', gap: 8 }}>
                {filterOptions.reasons.map((reason) => (
                  <label key={reason} style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={filters.reasons.includes(reason)}
                      onChange={(e) => {
                        const nextReasons = e.target.checked
                          ? [...filters.reasons, reason]
                          : filters.reasons.filter(r => r !== reason)
                        onFiltersChange({ ...filters, reasons: nextReasons })
                      }}
                      style={{ width: 16, height: 16, cursor: 'pointer' }}
                    />
                    <span style={{ fontSize: 13 }}>{reason.replace(/_/g, ' ')}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* App */}
      <div style={{ marginBottom: 30 }}>
        <h3 style={{ marginTop: 0, fontSize: 16 }}>App</h3>
        {appSettingsLoading ? (
          <p style={{ color: '#666', fontSize: 13 }}>Loading app preferences...</p>
        ) : appSettings ? (
          <>
            {appSettingsError && (
              <div style={{ color: '#b42318', fontSize: 12, marginBottom: 10 }}>
                {appSettingsError}
              </div>
            )}

            <div style={{ display: 'grid', gap: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(appSettings.launchAtLogin)}
                  disabled={appSettingsSaving}
                  onChange={(e) => saveAppSettings({ launchAtLogin: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13 }}>Launch at login</span>
              </label>

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(appSettings.showMenubarIcon)}
                  disabled={appSettingsSaving}
                  onChange={(e) => saveAppSettings({ showMenubarIcon: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13 }}>Show menubar icon</span>
              </label>

              {isMac && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={Boolean(appSettings.showDockIcon)}
                    disabled={appSettingsSaving}
                    onChange={(e) => saveAppSettings({ showDockIcon: e.target.checked })}
                    style={{ width: 16, height: 16, cursor: 'pointer' }}
                  />
                  <span style={{ fontSize: 13 }}>Show dock icon</span>
                </label>
              )}

              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={Boolean(appSettings.closeToTray)}
                  disabled={appSettingsSaving}
                  onChange={(e) => saveAppSettings({ closeToTray: e.target.checked })}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 13 }}>Close window to background (hide)</span>
              </label>
            </div>

            <p style={{ fontSize: 12, color: '#666', marginTop: 10 }}>
              Tip: If you hide the dock icon, GitSignal is accessible from the menubar icon.
            </p>
          </>
        ) : (
          <p style={{ color: '#666', fontSize: 13 }}>App preferences not available.</p>
        )}
      </div>

      {/* Danger Zone */}
      <div style={{ marginBottom: 20, padding: 15, border: '1px solid #f85149', borderRadius: 6 }}>
        <h3 style={{ marginTop: 0, fontSize: 16, color: '#d1242f' }}>Danger Zone</h3>
        <button
          onClick={onLogout}
          style={{
            padding: '8px 16px',
            fontSize: 13,
            background: '#d1242f',
            color: 'white',
            border: 'none',
            borderRadius: 4,
            cursor: 'pointer'
          }}
        >
          Sign Out & Clear Token
        </button>
      </div>
    </div>
  )
}

// Filter bar component
function FilterBar({ notifications, filters, onFilterChange }) {
  const [isExpanded, setIsExpanded] = useState(false)

  const { types: availableTypes, reasons: availableReasons } = getFilterOptions(notifications, filters)

  const toggleFilter = (category, value) => {
    const current = filters[category]
    const newValues = current.includes(value)
      ? current.filter(v => v !== value)
      : [...current, value]

    onFilterChange({ ...filters, [category]: newValues })
  }

  const clearFilters = () => {
    onFilterChange({ types: [], reasons: [] })
  }

  const hasActiveFilters = filters.types.length > 0 || filters.reasons.length > 0
  const activeFilterCount = filters.types.length + filters.reasons.length

  return (
    <div style={{ marginBottom: 15, border: '1px solid #d0d7de', borderRadius: 6, overflow: 'hidden' }}>
      {/* Header - always visible */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '8px 12px',
          background: hasActiveFilters ? '#ddf4ff' : '#f6f8fa',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          transition: 'background 0.2s'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12 }}>{isExpanded ? '▼' : '▶'}</span>
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            Filters
            {activeFilterCount > 0 && (
              <span style={{
                marginLeft: 6,
                fontSize: 11,
                background: '#0969da',
                color: 'white',
                padding: '2px 6px',
                borderRadius: 10,
                fontWeight: 600
              }}>
                {activeFilterCount}
              </span>
            )}
          </span>
        </div>
        {hasActiveFilters && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              clearFilters()
            }}
            style={{
              padding: '3px 8px',
              fontSize: 11,
              background: 'white',
              border: '1px solid #d0d7de',
              borderRadius: 4,
              cursor: 'pointer'
            }}
          >
            Clear
          </button>
        )}
      </div>

      {/* Expandable filter content */}
      {isExpanded && (
        <div style={{ padding: 12, borderTop: '1px solid #d0d7de', background: 'white' }}>
          {/* Type filters */}
          {availableTypes.length > 0 && (
            <div style={{ marginBottom: availableReasons.length > 0 ? 12 : 0 }}>
              <div style={{ fontSize: 11, color: '#57606a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>
                Type
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {availableTypes.map(type => (
                  <button
                    key={type}
                    onClick={() => toggleFilter('types', type)}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      border: filters.types.includes(type) ? '1px solid #0969da' : '1px solid #d0d7de',
                      borderRadius: 6,
                      background: filters.types.includes(type) ? '#0969da' : 'white',
                      color: filters.types.includes(type) ? 'white' : '#24292f',
                      cursor: 'pointer',
                      fontWeight: 500,
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (!filters.types.includes(type)) {
                        e.currentTarget.style.background = '#f6f8fa'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!filters.types.includes(type)) {
                        e.currentTarget.style.background = 'white'
                      }
                    }}
                  >
                    {type}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Reason filters */}
          {availableReasons.length > 0 && (
            <div>
              <div style={{ fontSize: 11, color: '#57606a', marginBottom: 6, fontWeight: 600, textTransform: 'uppercase' }}>
                Reason
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {availableReasons.map(reason => (
                  <button
                    key={reason}
                    onClick={() => toggleFilter('reasons', reason)}
                    style={{
                      padding: '5px 12px',
                      fontSize: 12,
                      border: filters.reasons.includes(reason) ? '1px solid #0969da' : '1px solid #d0d7de',
                      borderRadius: 6,
                      background: filters.reasons.includes(reason) ? '#0969da' : 'white',
                      color: filters.reasons.includes(reason) ? 'white' : '#24292f',
                      cursor: 'pointer',
                      fontWeight: 500,
                      transition: 'all 0.15s'
                    }}
                    onMouseEnter={(e) => {
                      if (!filters.reasons.includes(reason)) {
                        e.currentTarget.style.background = '#f6f8fa'
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (!filters.reasons.includes(reason)) {
                        e.currentTarget.style.background = 'white'
                      }
                    }}
                  >
                    {reason.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Token input form component
function TokenInputForm({ onSubmit, isLoading, error }) {
  const [token, setTokenValue] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (token.trim()) {
      onSubmit(token.trim())
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="password"
        value={token}
        onChange={(e) => setTokenValue(e.target.value)}
        placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
        disabled={isLoading}
        style={{
          width: '100%',
          padding: '10px',
          fontSize: 14,
          fontFamily: 'monospace',
          border: '1px solid #ddd',
          borderRadius: 4,
          marginBottom: 10
        }}
      />
      {error && (
        <div style={{ color: 'red', fontSize: 12, marginBottom: 10 }}>
          {error}
        </div>
      )}
      <button
        type="submit"
        disabled={isLoading || !token.trim()}
        style={{
          padding: '10px 20px',
          fontSize: 14,
          cursor: isLoading ? 'wait' : 'pointer',
          opacity: (!token.trim() || isLoading) ? 0.5 : 1
        }}
      >
        {isLoading ? 'Validating...' : 'Save Token'}
      </button>
    </form>
  )
}

function WebLanding() {
  const repoUrl = import.meta.env.VITE_REPO_URL || 'https://github.com/hasit/gitsignal'
  const releasesUrl = `${repoUrl.replace(/\/$/, '')}/releases/latest`
  const baseUrl = import.meta.env.BASE_URL || '/'
  const features = [
    { title: 'Menubar app', description: 'Always-on access to your GitHub notifications.' },
    { title: 'Native notifications', description: 'macOS notifications with direct links back to GitHub.' },
    { title: 'Fast polling', description: 'ETag caching for efficient refreshes.' },
    { title: 'Mark as read', description: 'Mark individual or all notifications as read.' },
    { title: 'Secure storage', description: 'Stores your token in macOS Keychain (via keytar).' },
    { title: 'No OAuth setup', description: 'Paste a token and you’re good to go.' }
  ]

  return (
    <div className="web-landing">
      <div className="web-hero">
        <div>
          <h1 className="web-title">GitSignal</h1>
          <p className="web-subtitle">
            GitHub notifications in your macOS menubar.
          </p>

          <div className="web-cta">
            <a
              href={releasesUrl}
              target="_blank"
              rel="noreferrer"
              className="web-button web-buttonPrimary"
            >
              Download latest (macOS)
            </a>
            <a
              href={repoUrl}
              target="_blank"
              rel="noreferrer"
              className="web-button"
            >
              View on GitHub
            </a>
          </div>

          <div className="web-install">
            <h2 className="web-sectionTitle">Install</h2>
            <ol className="web-list">
              <li>Download the latest <code>.dmg</code> from GitHub Releases</li>
              <li>Open it and drag GitSignal into <code>Applications</code></li>
              <li>Launch GitSignal and paste your GitHub token</li>
            </ol>
          </div>
        </div>

        <div className="web-screenshotWrap">
          <img
            src={`${baseUrl}screenshot.svg`}
            alt="GitSignal app screenshot"
            className="web-screenshot"
          />
        </div>
      </div>

      <div className="web-features">
        <h2 className="web-sectionTitle">Features</h2>
        <div className="web-featureGrid">
          {features.map((feature) => (
            <div key={feature.title} className="web-featureCard">
              <div className="web-featureTitle">{feature.title}</div>
              <div className="web-featureDescription">{feature.description}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  console.log('App component rendering...')
  const [notifications, setNotifications] = useState([])
  const [status, setStatus] = useState('checking-auth')
  const [error, setError] = useState(null)
  const [runtime] = useState(() => (window.electron?.auth ? 'electron' : 'web'))
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [networkInFlight, setNetworkInFlight] = useState(0)
  const [showSettings, setShowSettings] = useState(false)
  const [markAsReadOnClick, setMarkAsReadOnClick] = useState(
    localStorage.getItem('markAsReadOnClick') === 'true'
  )
  const [filters, setFilters] = useState(() => loadFiltersFromStorage())
  const filtersRef = useRef(filters)
  const [selectedNotifications, setSelectedNotifications] = useState(new Set())
  const isFetching = networkInFlight > 0

  const trackNetwork = (loading) => {
    setNetworkInFlight((prev) => Math.max(0, prev + (loading ? 1 : -1)))
  }

  useEffect(() => {
    try {
      localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(filters))
    } catch {
      // ignore
    }
  }, [filters])

  useEffect(() => {
    filtersRef.current = filters
  }, [filters])

  // Check for existing token on mount
  useEffect(() => {
    async function checkAuth() {
      if (runtime !== 'electron') {
        setStatus('web')
        return
      }

      try {
        const token = await window.electron.auth.getToken()
        if (token) {
          setToken(token)
          setIsAuthenticated(true)
          setStatus('authenticated')
        } else {
          setStatus('not-authenticated')
        }
      } catch (err) {
        console.error('Auth check error:', err)
        setStatus('not-authenticated')
      }
    }

    checkAuth()
  }, [runtime])

  useEffect(() => {
    if (runtime !== 'electron') return
    if (!window.electron?.on) return

    window.electron.on('mark-all-read', async () => {
      trackNetwork(true)
      try {
        await markAllRead()
        setNotifications([])
      } finally {
        trackNetwork(false)
      }
    })

    window.electron.on('open-preferences', () => {
      setShowSettings(true)
    })
  }, [runtime])

  // Start polling when authenticated
  useEffect(() => {
    if (!isAuthenticated) return

    try {
      setStatus('polling')
      const stop = startPolling({
        onLoading: trackNetwork,
        onUpdate: (data) => {
          setNotifications(data)
        },
        onNew: (newItems) => {
          const visibleNewItems = newItems.filter(n => matchesFilters(n, filtersRef.current))
          visibleNewItems.forEach(n => {
            if (window.electron?.notify) {
              window.electron.notify({
                title: n.subject.title,
                body: n.repo.full_name,
                url: n.htmlUrl || `https://github.com/${n.repo.full_name}`
              })
            }
          })
        }
      })

      return () => stop()
    } catch (err) {
      setError(err.message)
    }
  }, [isAuthenticated])

  // Handle token save
  const handleSaveToken = async (token) => {
    setIsAuthenticating(true)
    setError(null)

    try {
      // Validate token by making a test API call
      const response = await fetch('https://api.github.com/notifications?per_page=1', {
        headers: {
          'Authorization': `token ${token}`,
        }
      })

      if (!response.ok) {
        throw new Error('Invalid token. Please check and try again.')
      }

      // Save to keychain
      await window.electron.auth.saveToken(token)

      setToken(token)
      setIsAuthenticated(true)
      setStatus('authenticated')
    } catch (err) {
      setError(err.message)
    } finally {
      setIsAuthenticating(false)
    }
  }

  // Handle logout
  const handleLogout = async () => {
    try {
      await window.electron.auth.logout()
      setToken(null)
      setIsAuthenticated(false)
      setNotifications([])
      setStatus('not-authenticated')
    } catch (err) {
      setError(err.message)
    }
  }

  // Handle mark as read on click change
  const handleMarkAsReadOnClickChange = (value) => {
    setMarkAsReadOnClick(value)
    localStorage.setItem('markAsReadOnClick', value)
  }

  // Handle force refresh
  const handleRefresh = async () => {
    setStatus('refreshing')
    trackNetwork(true)
    try {
      const data = await forceRefresh()
      if (data !== null) {
        setNotifications(data)
      }
      setStatus('authenticated')
    } catch (err) {
      console.error('Refresh failed:', err)
      setStatus('authenticated')
    } finally {
      trackNetwork(false)
    }
  }

  if (runtime === 'web') {
    return <WebLanding />
  }

  if (error) {
    return (
      <div style={{ padding: 20 }}>
        <h1>GitSignal</h1>
        <div style={{ color: 'red', padding: 10, background: '#fee', borderRadius: 4, marginBottom: 10 }}>
          Error: {error}
        </div>
        <button onClick={() => window.location.reload()} disabled={isAuthenticating}>
          {isAuthenticating ? 'Reloading...' : 'Reload'}
        </button>
      </div>
    )
  }

  if (showSettings) {
    return (
      <Settings
        onClose={() => setShowSettings(false)}
        onLogout={handleLogout}
        markAsReadOnClick={markAsReadOnClick}
        onMarkAsReadOnClickChange={handleMarkAsReadOnClickChange}
        filters={filters}
        onFiltersChange={setFilters}
        notifications={notifications}
      />
    )
  }

  // Not authenticated - show token input screen
  if (!isAuthenticated) {
    return (
      <div style={{ padding: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h1 style={{ margin: 0 }}>GitSignal</h1>
          <button onClick={() => setShowSettings(true)} style={{ padding: '6px 12px' }} title="Settings">
            ⚙️
          </button>
        </div>
        <p>Welcome to GitSignal! Connect your GitHub account to get started.</p>

        <div style={{ padding: 20, background: '#f5f5f5', borderRadius: 8, marginTop: 20 }}>
          <h2 style={{ marginTop: 0 }}>Add GitHub Personal Access Token</h2>
          <p style={{ color: '#666', fontSize: 14 }}>
            Create a classic token with <code>notifications</code> scope.
          </p>

          <TokenInputForm
            onSubmit={handleSaveToken}
            isLoading={isAuthenticating}
            error={error}
          />
        </div>

        <div style={{ marginTop: 20, padding: 15, background: '#e3f2fd', borderRadius: 4, fontSize: 13 }}>
          <strong>📝 How to create a token:</strong>
          <ol style={{ marginTop: 10, marginBottom: 0, paddingLeft: 20 }}>
            <li>Go to <a href="#" onClick={(e) => { e.preventDefault(); window.electron?.openExternal('https://github.com/settings/tokens/new') }}>GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic)</a></li>
            <li>Click "Generate new token (classic)"</li>
            <li>Name it "GitSignal" and pick an expiration</li>
            <li>Select scope: <code>notifications</code></li>
            <li>Click "Generate token", then copy/paste it above</li>
          </ol>
        </div>
      </div>
    )
  }

  return (
    <div style={{ padding: 20 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h1 style={{ margin: 0 }}>GitSignal</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleRefresh}
            style={{ padding: '6px 12px' }}
            disabled={isFetching}
            title="Refresh notifications"
          >
            {isFetching ? '⟳' : '🔄'}
          </button>
          <button onClick={() => setShowSettings(true)} style={{ padding: '6px 12px' }} title="Settings">
            ⚙️
          </button>
        </div>
      </div>

      {/* Filter bar - only show if there are notifications */}
      {notifications.length > 0 && (
        <FilterBar
          notifications={notifications}
          filters={filters}
          onFilterChange={setFilters}
        />
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
	          <span style={{ color: '#666' }}>
	            {(() => {
	              // Apply filters
	              const filtered = notifications.filter(n => {
	                const typeMatch = filters.types.length === 0 || filters.types.includes(n.subject.type)
	                const reasonMatch = filters.reasons.length === 0 || filters.reasons.includes(n.reason)
	                return typeMatch && reasonMatch
	              })
	              return `${filtered.length} of ${notifications.length} notifications${isFetching ? ' • Updating…' : ''}`
	            })()}
	          </span>
          {selectedNotifications.size > 0 && (
            <span style={{
              fontSize: 11,
              background: '#0969da',
              color: 'white',
              padding: '3px 8px',
              borderRadius: 12,
              fontWeight: 600
            }}>
              {selectedNotifications.size} selected
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {selectedNotifications.size > 0 ? (
            <>
              <button
                onClick={async () => {
                  trackNetwork(true)
                  try {
                  const token = await window.electron.auth.getToken()
                  if (!token) return

                  const selectedIds = Array.from(selectedNotifications)

                  // Mark selected as read
                  const promises = selectedIds.map(async (id) => {
                    try {
                      await fetch(`https://api.github.com/notifications/threads/${id}`, {
                        method: 'PATCH',
                        headers: { 'Authorization': `token ${token}` }
                      })
                      markAsReadLocally(id)
                      return id
                    } catch (err) {
                      console.error('Failed to mark as read:', err)
                      return null
                    }
                  })

                  // Wait for all requests to complete
                  const markedIds = (await Promise.all(promises)).filter(id => id !== null)

                  // Remove successfully marked notifications from local state
                  setNotifications(prev => prev.filter(n => !markedIds.includes(n.id)))
                  setSelectedNotifications(new Set())
                  } finally {
                    trackNetwork(false)
                  }
                }}
                style={{ padding: '4px 10px', fontSize: 12, background: '#0969da', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}
              >
                Mark {selectedNotifications.size} as read
              </button>
              <button
                onClick={() => setSelectedNotifications(new Set())}
                style={{ padding: '4px 10px', fontSize: 12 }}
              >
                Clear selection
              </button>
            </>
          ) : (
            <button
              onClick={async () => {
                trackNetwork(true)
                try {
                  await markAllRead()
                  setNotifications([])
                } finally {
                  trackNetwork(false)
                }
              }}
              style={{ padding: '4px 10px', fontSize: 12 }}
            >
              Mark all read
            </button>
          )}
        </div>
      </div>

      <div>
        {(() => {
          // Apply filters to notifications
          const filtered = notifications.filter(n => {
            const typeMatch = filters.types.length === 0 || filters.types.includes(n.subject.type)
            const reasonMatch = filters.reasons.length === 0 || filters.reasons.includes(n.reason)
            return typeMatch && reasonMatch
          })

	          if (notifications.length === 0) {
	            return (
	              <p style={{ color: '#666', textAlign: 'center', padding: 40 }}>
	                {isFetching ? 'Loading notifications…' : "No notifications. You're all caught up! 🎉"}
	              </p>
	            )
	          }

          if (filtered.length === 0) {
            return (
              <p style={{ color: '#666', textAlign: 'center', padding: 40 }}>
                No notifications match the selected filters.
              </p>
            )
          }

          return <NotificationsByRepo
            notifications={filtered}
            markAsReadOnClick={markAsReadOnClick}
            selectedNotifications={selectedNotifications}
            onToggleSelect={(id) => {
              setSelectedNotifications(prev => {
                const newSet = new Set(prev)
                if (newSet.has(id)) {
                  newSet.delete(id)
                } else {
                  newSet.add(id)
                }
                return newSet
              })
            }}
            onNotificationRead={(id) => {
              setNotifications(prev => prev.filter(n => n.id !== id))
            }}
          />
        })()}
      </div>
    </div>
  )
}

// Group notifications by repository
function NotificationsByRepo({ notifications, markAsReadOnClick, selectedNotifications, onToggleSelect, onNotificationRead }) {
  // Group by repo
  const grouped = notifications.reduce((acc, n) => {
    const repoName = n.repo.full_name
    if (!acc[repoName]) {
      acc[repoName] = []
    }
    acc[repoName].push(n)
    return acc
  }, {})

  const repos = Object.keys(grouped).sort()

  return (
    <div>
      {repos.map(repoName => (
        <RepoGroup
          key={repoName}
          repoName={repoName}
          notifications={grouped[repoName]}
          markAsReadOnClick={markAsReadOnClick}
          selectedNotifications={selectedNotifications}
          onToggleSelect={onToggleSelect}
          onNotificationRead={onNotificationRead}
        />
      ))}
    </div>
  )
}

// Single repo group component
function RepoGroup({ repoName, notifications, markAsReadOnClick, selectedNotifications, onToggleSelect, onNotificationRead }) {
  const [isExpanded, setIsExpanded] = React.useState(true)

  // Check if all notifications in this repo are selected
  const allSelected = notifications.every(n => selectedNotifications.has(n.id))
  const someSelected = notifications.some(n => selectedNotifications.has(n.id)) && !allSelected

  const handleSelectAll = (e) => {
    e.stopPropagation() // Don't collapse/expand

    if (allSelected) {
      // Deselect all from this repo
      notifications.forEach(n => {
        if (selectedNotifications.has(n.id)) {
          onToggleSelect(n.id)
        }
      })
    } else {
      // Select all from this repo
      notifications.forEach(n => {
        if (!selectedNotifications.has(n.id)) {
          onToggleSelect(n.id)
        }
      })
    }
  }

  return (
    <div style={{ marginBottom: 15, border: '1px solid #e1e4e8', borderRadius: 6, overflow: 'hidden' }}>
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          padding: '10px 12px',
          background: '#f6f8fa',
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          borderBottom: isExpanded ? '1px solid #e1e4e8' : 'none'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="checkbox"
            checked={allSelected}
            ref={(input) => {
              if (input) input.indeterminate = someSelected
            }}
            onChange={handleSelectAll}
            onClick={(e) => e.stopPropagation()}
            title={allSelected ? 'Deselect all' : 'Select all'}
            style={{
              width: 16,
              height: 16,
              cursor: 'pointer',
              marginRight: 4
            }}
          />
          <span style={{ fontSize: 14 }}>{isExpanded ? '▼' : '▶'}</span>
          <strong style={{ fontSize: 13 }}>{repoName}</strong>
        </div>
        <span style={{
          fontSize: 11,
          background: '#0969da',
          color: 'white',
          padding: '2px 8px',
          borderRadius: 12,
          fontWeight: 600
        }}>
          {notifications.length}
        </span>
      </div>

      {isExpanded && (
        <div>
          {notifications.map(n => (
            <NotificationItem
              key={n.id}
              notification={n}
              markAsReadOnClick={markAsReadOnClick}
              isSelected={selectedNotifications.has(n.id)}
              onToggleSelect={onToggleSelect}
              onNotificationRead={onNotificationRead}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// Compact single-line notification item showing icon, title, reason, type, and timestamp
function NotificationItem({ notification, markAsReadOnClick, isSelected, onToggleSelect, onNotificationRead }) {
  const iconForReason = {
    'assign': '👤',
    'author': '✍️',
    'comment': '💬',
    'invitation': '📨',
    'manual': '🔖',
    'mention': '@',
    'review_requested': '👀',
    'security_alert': '⚠️',
    'state_change': '🔄',
    'subscribed': '🔔',
    'team_mention': '👥',
  }

  const icon = iconForReason[notification.reason] || '📬'
  const updatedAt = new Date(notification.updated_at)
  const timeAgo = formatTimeAgo(updatedAt)

  const handleClick = async (e) => {
    // Don't trigger if clicking checkbox
    if (e.target.type === 'checkbox') return

    // Mark as read if enabled
    if (markAsReadOnClick) {
      try {
        const token = await window.electron.auth.getToken()
        if (token) {
          // Mark as read locally first (optimistic update)
          markAsReadLocally(notification.id)

          const response = await fetch(`https://api.github.com/notifications/threads/${notification.id}`, {
            method: 'PATCH',
            headers: {
              'Authorization': `token ${token}`,
            },
          })

          // Remove from local state if successfully marked as read
          if (response.ok && onNotificationRead) {
            onNotificationRead(notification.id)
          }
        }
      } catch (err) {
        console.error('Failed to mark as read:', err)
      }
    }

    // Open the notification
    window.electron?.openExternal?.(notification.htmlUrl || `https://github.com/${notification.repo.full_name}`)
  }

  return (
    <div
      style={{
        padding: '8px 12px',
        borderBottom: '1px solid #f0f0f0',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: 12,
        cursor: 'pointer',
        transition: 'background 0.1s',
        background: isSelected ? '#f0f6ff' : 'transparent'
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.background = '#f6f8fa'
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.background = 'transparent'
      }}
      onClick={handleClick}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={() => onToggleSelect(notification.id)}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 16,
          height: 16,
          cursor: 'pointer',
          flexShrink: 0
        }}
      />

      {/* Icon */}
      <span style={{ fontSize: 14, flexShrink: 0 }}>{icon}</span>

      {/* Title */}
      <div style={{
        flex: 1,
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontWeight: 500
      }}>
        {notification.subject.title}
      </div>

      {/* Metadata: reason, type, timestamp */}
      <div style={{
        display: 'flex',
        gap: 8,
        fontSize: 11,
        color: '#666',
        flexShrink: 0
      }}>
        <span title="Reason">{notification.reason.replace(/_/g, ' ')}</span>
        <span>•</span>
        <span title="Type">{notification.subject.type}</span>
        <span>•</span>
        <span title="Last updated">{timeAgo}</span>
      </div>
    </div>
  )
}

// Helper function for time formatting
function formatTimeAgo(date) {
  const now = new Date()
  const diffMs = now - date
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMs / 3600000)
  const diffDays = Math.floor(diffMs / 86400000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`
  if (diffHours < 24) return `${diffHours}h ago`
  if (diffDays < 7) return `${diffDays}d ago`
  return date.toLocaleDateString()
}
