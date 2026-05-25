import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getSessionUser, assertRole } from '@/lib/auth-server';
import { getErrorMessage } from '@/lib/query-types';

// GET /api/admin/users - list all users
export async function GET() {
  try {
    const user = await getSessionUser();
    assertRole(user, ['admin']);

    const result = await pool.query(`
      SELECT user_id::text, username, role, enabled, created_at, updated_at
      FROM ops.users
      ORDER BY created_at DESC
    `);

    return NextResponse.json({ success: true, data: result.rows });
  } catch (error: unknown) {
    const status = (error as Record<string, number>)?.status || 500;
    if (status === 401 || status === 403) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status });
    }
    console.error('Error listing users:', error);
    return NextResponse.json({ success: false, error: 'Failed to list users' }, { status: 500 });
  }
}

// POST /api/admin/users - create user
export async function POST(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    assertRole(sessionUser, ['admin']);

    const body = await request.json();
    const { username, password, role } = body;

    if (!username || !password || !role) {
      return NextResponse.json({ success: false, error: 'username, password, and role required' }, { status: 400 });
    }

    if (!['admin', 'operator'].includes(role)) {
      return NextResponse.json({ success: false, error: 'role must be admin or operator' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json({ success: false, error: 'Password must be at least 6 characters' }, { status: 400 });
    }

    const result = await pool.query(
      `INSERT INTO ops.users (username, password_hash, role)
       VALUES ($1, crypt($2, gen_salt('bf')), $3)
       RETURNING user_id::text, username, role, enabled, created_at`,
      [username, password, role]
    );

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: unknown) {
    const status = (error as Record<string, number>)?.status || 500;
    if (status === 401 || status === 403) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status });
    }
    if ((error as Record<string, string>)?.code === '23505') {
      return NextResponse.json({ success: false, error: 'Username already exists' }, { status: 409 });
    }
    console.error('Error creating user:', error);
    return NextResponse.json({ success: false, error: 'Failed to create user' }, { status: 500 });
  }
}

// PUT /api/admin/users - update user
export async function PUT(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    assertRole(sessionUser, ['admin']);

    const body = await request.json();
    const { user_id, username, role, enabled, password } = body;

    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 });
    }

    if (role && !['admin', 'operator'].includes(role)) {
      return NextResponse.json({ success: false, error: 'role must be admin or operator' }, { status: 400 });
    }

    if (enabled === false && user_id === sessionUser.user_id) {
      return NextResponse.json({ success: false, error: 'Cannot disable your own account' }, { status: 400 });
    }

    let setClauses = '';
    const params: (string | number | boolean)[] = [];
    let idx = 1;

    if (username) { params.push(username); setClauses += `username = $${idx++},`; }
    if (role) { params.push(role); setClauses += `role = $${idx++},`; }
    if (enabled !== undefined) { params.push(enabled); setClauses += `enabled = $${idx++},`; }
    if (password) { params.push(password); setClauses += `password_hash = crypt($${idx++}, gen_salt('bf')),`; }

    if (!setClauses) {
      return NextResponse.json({ success: false, error: 'No fields to update' }, { status: 400 });
    }

    params.push(user_id);
    const result = await pool.query(
      `UPDATE ops.users SET ${setClauses} updated_at = now() WHERE user_id = $${idx}::uuid
       RETURNING user_id::text, username, role, enabled, created_at, updated_at`,
      params
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: result.rows[0] });
  } catch (error: unknown) {
    const status = (error as Record<string, number>)?.status || 500;
    if (status === 401 || status === 403) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status });
    }
    if ((error as Record<string, string>)?.code === '23505') {
      return NextResponse.json({ success: false, error: 'Username already exists' }, { status: 409 });
    }
    console.error('Error updating user:', error);
    return NextResponse.json({ success: false, error: 'Failed to update user' }, { status: 500 });
  }
}

// DELETE /api/admin/users?id={user_id} - hard delete
export async function DELETE(request: Request) {
  try {
    const sessionUser = await getSessionUser();
    assertRole(sessionUser, ['admin']);

    const { searchParams } = new URL(request.url);
    const user_id = searchParams.get('id');

    if (!user_id) {
      return NextResponse.json({ success: false, error: 'user_id required' }, { status: 400 });
    }

    if (user_id === sessionUser.user_id) {
      return NextResponse.json({ success: false, error: 'Cannot delete your own account' }, { status: 400 });
    }

    const result = await pool.query(
      `DELETE FROM ops.users WHERE user_id = $1::uuid RETURNING user_id::text`,
      [user_id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ success: false, error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, message: 'User deleted' });
  } catch (error: unknown) {
    const status = (error as Record<string, number>)?.status || 500;
    if (status === 401 || status === 403) {
      return NextResponse.json({ success: false, error: (error as Error).message }, { status });
    }
    console.error('Error deleting user:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete user' }, { status: 500 });
  }
}
