import React, { useState, useEffect, useCallback } from 'react';
import api from '../utils/apiClient';
import { relativeTime } from '../utils/relativeTime';

export default function UsersAdminPanel({ title = 'Members' }) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [createForm, setCreateForm] = useState({ email: '', password: '', isAdmin: false });
  const [resetPasswordFor, setResetPasswordFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [busyUserId, setBusyUserId] = useState(null);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get('/api/admin/users');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || 'Failed to load users');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const res = await api.post('/api/admin/users', {
        email: createForm.email.trim(),
        password: createForm.password,
        isAdmin: createForm.isAdmin,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create user');
      setCreateForm({ email: '', password: '', isAdmin: false });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to create user');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleAdmin = async (user) => {
    setError('');
    setBusyUserId(user.id);
    try {
      const res = await api.put(`/api/admin/users/${user.id}/admin`, { isAdmin: !user.isAdmin });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update admin access');
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to update admin access');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = async (userId) => {
    setError('');
    setBusyUserId(userId);
    try {
      const res = await api.put(`/api/admin/users/${userId}/password`, { password: newPassword });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to reset password');
      setResetPasswordFor(null);
      setNewPassword('');
    } catch (err) {
      setError(err.message || 'Failed to reset password');
    } finally {
      setBusyUserId(null);
    }
  };

  const handleDelete = async (userId) => {
    setError('');
    setBusyUserId(userId);
    try {
      const res = await api.delete(`/api/admin/users/${userId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to delete user');
      setDeleteConfirmId(null);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Failed to delete user');
    } finally {
      setBusyUserId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: 'var(--color-text)' }}>{title}</h2>
        <p className="text-sm mt-0.5" style={{ color: 'var(--color-muted)' }}>
          Create accounts and manage access.
        </p>
      </div>

      <form
        onSubmit={handleCreateUser}
        className="rounded-2xl border p-4 space-y-3"
        style={{ background: 'var(--color-surface)', borderColor: 'var(--color-border)' }}
      >
        <div className="grid sm:grid-cols-2 gap-3">
          <input
            type="email"
            value={createForm.email}
            onChange={(e) => setCreateForm(v => ({ ...v, email: e.target.value }))}
            required
            placeholder="new-user@example.com"
            className="px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
          <input
            type="password"
            value={createForm.password}
            onChange={(e) => setCreateForm(v => ({ ...v, password: e.target.value }))}
            required
            minLength={8}
            placeholder="Temporary password (min 8 chars)"
            className="px-3 py-2 rounded-lg border text-sm outline-none"
            style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
          />
        </div>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <label className="text-xs flex items-center gap-2" style={{ color: 'var(--color-muted)' }}>
            <input
              type="checkbox"
              checked={createForm.isAdmin}
              onChange={(e) => setCreateForm(v => ({ ...v, isAdmin: e.target.checked }))}
            />
            Grant admin access
          </label>
          <button
            type="submit"
            disabled={creating}
            className="px-4 py-2 rounded-lg text-sm font-medium text-white disabled:opacity-50 hover:opacity-80 transition-opacity"
            style={{ background: 'var(--color-primary)' }}
          >
            {creating ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </form>

      {error && <p className="text-sm" style={{ color: '#ef4444' }}>{error}</p>}

      {loading ? (
        <div className="rounded-2xl border p-8 text-center text-sm" style={{ borderColor: 'var(--color-border)', background: 'var(--color-surface)', color: 'var(--color-muted)' }}>
          Loading users…
        </div>
      ) : (
        <div className="rounded-2xl border overflow-x-auto" style={{ borderColor: 'var(--color-border)' }}>
          <table className="w-full text-xs min-w-[640px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--color-surface)', borderBottom: '1px solid var(--color-border)' }}>
                {['User', 'Role', 'Created', 'Last login', 'Actions'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-left font-semibold uppercase tracking-wider" style={{ color: 'var(--color-muted)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((user, i) => (
                <tr
                  key={user.id}
                  style={{
                    background: 'var(--color-surface)',
                    borderBottom: i < users.length - 1 ? '1px solid var(--color-border)' : undefined,
                  }}
                >
                  <td className="px-3 py-2.5">
                    <div className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{user.email}</div>
                    {user.activeSessions > 0 && (
                      <div className="text-xs" style={{ color: '#22c55e' }}>
                        {user.activeSessions} active session{user.activeSessions === 1 ? '' : 's'}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: user.isAdmin ? 'var(--color-primary)' : 'var(--color-muted)' }}>
                    {user.isAdmin ? 'Admin' : 'User'}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--color-muted)' }}>
                    {new Date(user.createdAt).toLocaleDateString()}
                  </td>
                  <td className="px-3 py-2.5" style={{ color: 'var(--color-muted)' }}>
                    {user.lastLoginAt ? relativeTime(user.lastLoginAt) : 'Never'}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <button
                        onClick={() => handleToggleAdmin(user)}
                        disabled={busyUserId === user.id}
                        className="px-2.5 py-1 rounded-md text-xs border hover:opacity-70 transition-opacity disabled:opacity-50"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        {user.isAdmin ? 'Remove Admin' : 'Make Admin'}
                      </button>
                      <button
                        onClick={() => {
                          setResetPasswordFor(user.id);
                          setDeleteConfirmId(null);
                          setNewPassword('');
                        }}
                        disabled={busyUserId === user.id}
                        className="px-2.5 py-1 rounded-md text-xs border hover:opacity-70 transition-opacity disabled:opacity-50"
                        style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                      >
                        Reset Password
                      </button>
                      {deleteConfirmId === user.id ? (
                        <>
                          <button
                            onClick={() => handleDelete(user.id)}
                            disabled={busyUserId === user.id}
                            className="px-2.5 py-1 rounded-md text-xs text-white disabled:opacity-50"
                            style={{ background: '#ef4444' }}
                          >
                            Confirm Delete
                          </button>
                          <button
                            onClick={() => setDeleteConfirmId(null)}
                            className="px-2.5 py-1 rounded-md text-xs border hover:opacity-70 transition-opacity"
                            style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => {
                            setDeleteConfirmId(user.id);
                            setResetPasswordFor(null);
                          }}
                          disabled={busyUserId === user.id}
                          className="px-2.5 py-1 rounded-md text-xs border hover:opacity-70 transition-opacity disabled:opacity-50"
                          style={{ borderColor: '#ef444440', color: '#ef4444' }}
                        >
                          Delete
                        </button>
                      )}
                    </div>

                    {resetPasswordFor === user.id && (
                      <div className="mt-2 flex items-center gap-2 flex-wrap">
                        <input
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          minLength={8}
                          placeholder="New password (min 8 chars)"
                          className="px-2.5 py-1.5 rounded-md border text-xs outline-none"
                          style={{ borderColor: 'var(--color-border)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                        />
                        <button
                          onClick={() => handleResetPassword(user.id)}
                          disabled={newPassword.length < 8 || busyUserId === user.id}
                          className="px-2.5 py-1.5 rounded-md text-xs text-white disabled:opacity-50"
                          style={{ background: 'var(--color-primary)' }}
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setResetPasswordFor(null);
                            setNewPassword('');
                          }}
                          className="px-2.5 py-1.5 rounded-md text-xs border hover:opacity-70 transition-opacity"
                          style={{ borderColor: 'var(--color-border)', color: 'var(--color-muted)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
