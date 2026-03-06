'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { db } from '@/lib/firebase';

const GROUP_ID = 'bFAbRGkZGysHBWO6U3BY';

type Post = {
  id: string;
  text: string;
  createdAt?: any;
  authorId: string;
  groupId: string;
  isDeleted: boolean;
};

type Comment = {
  id: string;
  text: string;
  createdAt?: any;
  authorId: string;
};

export default function TestPostsPage() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Crear post
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);

  // Comentarios por post
  const [commentsByPost, setCommentsByPost] = useState<Record<string, Comment[]>>({});
  const [loadingComments, setLoadingComments] = useState<Record<string, boolean>>({});
  const [commentTextByPost, setCommentTextByPost] = useState<Record<string, string>>({});
  const [creatingComment, setCreatingComment] = useState<Record<string, boolean>>({});

  const auth = useMemo(() => getAuth(), []);
  const uid = auth.currentUser?.uid ?? null;

  const fetchPosts = async () => {
    const q = query(
      collection(db, 'posts'),
      where('groupId', '==', GROUP_ID),
      where('isDeleted', '==', false),
      orderBy('createdAt', 'desc')
    );

    const snap = await getDocs(q);
    setPosts(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })));
  };

  useEffect(() => {
    const run = async () => {
      try {
        setError(null);
        await fetchPosts();
      } catch (e: any) {
        console.error(e);
        setError(e?.message ?? 'Error desconocido');
      }
    };

    run();
  }, []);

  const createPost = async () => {
    try {
      setError(null);
      setCreating(true);

      const uidNow = getAuth().currentUser?.uid;
      if (!uidNow) throw new Error('Debes iniciar sesión para crear un post.');

      const cleanText = text.trim();
      if (!cleanText) throw new Error('Escribe un texto antes de publicar.');

      await addDoc(collection(db, 'posts'), {
        groupId: GROUP_ID,
        authorId: uidNow,
        text: cleanText,
        createdAt: serverTimestamp(),
        isDeleted: false,
      });

      setText('');
      await fetchPosts();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'Error desconocido');
    } finally {
      setCreating(false);
    }
  };

  const softDeletePost = async (postId: string) => {
    try {
      setError(null);
      await updateDoc(doc(db, 'posts', postId), { isDeleted: true });

      setCommentsByPost((prev) => {
        const copy = { ...prev };
        delete copy[postId];
        return copy;
      });

      setCommentTextByPost((prev) => {
        const copy = { ...prev };
        delete copy[postId];
        return copy;
      });

      await fetchPosts();
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'Error desconocido');
    }
  };

  const fetchComments = async (postId: string) => {
    try {
      setError(null);
      setLoadingComments((prev) => ({ ...prev, [postId]: true }));

      const q = query(
        collection(db, 'posts', postId, 'comments'),
        orderBy('createdAt', 'asc')
      );

      const snap = await getDocs(q);
      const comments = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) })) as Comment[];

      setCommentsByPost((prev) => ({ ...prev, [postId]: comments }));
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'Error desconocido');
    } finally {
      setLoadingComments((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const createComment = async (postId: string) => {
    try {
      setError(null);
      setCreatingComment((prev) => ({ ...prev, [postId]: true }));

      const uidNow = getAuth().currentUser?.uid;
      if (!uidNow) throw new Error('Debes iniciar sesión para comentar.');

      const raw = commentTextByPost[postId] ?? '';
      const clean = raw.trim();
      if (!clean) throw new Error('Escribe un comentario antes de enviar.');

      await addDoc(collection(db, 'posts', postId, 'comments'), {
        authorId: uidNow,
        text: clean,
        createdAt: serverTimestamp(),
      });

      setCommentTextByPost((prev) => ({ ...prev, [postId]: '' }));
      await fetchComments(postId);
    } catch (e: any) {
      console.error(e);
      setError(e?.message ?? 'Error desconocido');
    } finally {
      setCreatingComment((prev) => ({ ...prev, [postId]: false }));
    }
  };

  const fontStack =
    '-apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", system-ui, sans-serif';

  const pageWrap: React.CSSProperties = {
    minHeight: '100vh',
    background: '#000',
    color: '#fff',
    fontFamily: fontStack,
    padding: 24,
  };

  const containerStyle: React.CSSProperties = {
    width: '100%',
    maxWidth: 860,
    margin: '0 auto',
  };

  const cardStyle: React.CSSProperties = {
    borderRadius: 16,
    border: '1px solid rgba(255,255,255,0.22)',
    background: 'rgba(12,12,12,0.9)',
    boxShadow: '0 20px 60px rgba(0,0,0,0.6)',
  };

  const sectionPadding: React.CSSProperties = {
    padding: 24,
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '11px 12px',
    marginTop: 8,
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.30)',
    background: 'rgba(0,0,0,0.32)',
    color: '#fff',
    outline: 'none',
    fontSize: 14,
  };

  const primaryButton: React.CSSProperties = {
    marginTop: 8,
    padding: '11px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.28)',
    background: '#fff',
    color: '#000',
    cursor: 'pointer',
    fontWeight: 600,
    fontSize: 14,
  };

  const secondaryButton: React.CSSProperties = {
    marginTop: 8,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.24)',
    background: 'rgba(255,255,255,0.08)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 13,
  };

  const dangerButton: React.CSSProperties = {
    marginTop: 8,
    padding: '10px 12px',
    borderRadius: 10,
    border: '1px solid rgba(255,255,255,0.24)',
    background: 'rgba(255,255,255,0.06)',
    color: '#fff',
    cursor: 'pointer',
    fontWeight: 500,
    fontSize: 13,
  };

  const subtleText: React.CSSProperties = {
    fontSize: 13,
    color: 'rgba(255,255,255,0.78)',
  };

  return (
    <main style={pageWrap}>
      <div style={containerStyle}>
        <div style={{ marginBottom: 18 }}>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 600,
            }}
          >
            Test Posts
          </h1>

          <p
            style={{
              marginTop: 6,
              marginBottom: 0,
              fontSize: 14,
              fontWeight: 400,
              color: 'rgba(255,255,255,0.78)',
            }}
          >
            Vista de prueba para creación de posts y comentarios.
          </p>

          <p style={{ ...subtleText, marginTop: 10, marginBottom: 0 }}>
            UID actual: {uid ?? 'no hay sesión'}
          </p>
        </div>

        <div style={cardStyle}>
          <div style={sectionPadding}>
            <h3
              style={{
                marginTop: 0,
                marginBottom: 14,
                fontSize: 18,
                fontWeight: 600,
              }}
            >
              Crear post
            </h3>

            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Escribe algo..."
              style={inputStyle}
            />

            <button
              onClick={createPost}
              disabled={creating || text.trim().length === 0}
              style={{
                ...primaryButton,
                background:
                  creating || text.trim().length === 0 ? 'rgba(255,255,255,0.15)' : '#fff',
                color: creating || text.trim().length === 0 ? '#fff' : '#000',
                cursor:
                  creating || text.trim().length === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              {creating ? 'Creando...' : 'Publicar'}
            </button>

            <p style={{ ...subtleText, marginTop: 10, marginBottom: 0 }}>
              Tip: debes estar logueado en <code>/login</code> para poder publicar y comentar.
            </p>
          </div>
        </div>

        {error && (
          <div
            style={{
              marginTop: 16,
              borderRadius: 12,
              border: '1px solid rgba(255,255,255,0.24)',
              background: 'rgba(255,255,255,0.08)',
              padding: 12,
              fontSize: 13,
              color: 'rgba(255,255,255,0.92)',
              whiteSpace: 'pre-wrap',
            }}
          >
            ❌ {error}
          </div>
        )}

        {!error && posts.length === 0 && (
          <div
            style={{
              ...cardStyle,
              marginTop: 16,
            }}
          >
            <div style={sectionPadding}>
              <p
                style={{
                  margin: 0,
                  fontSize: 14,
                  color: 'rgba(255,255,255,0.82)',
                }}
              >
                No hay posts.
              </p>
            </div>
          </div>
        )}

        {posts.map((p) => {
          const comments = commentsByPost[p.id] ?? null;
          const isLoading = !!loadingComments[p.id];
          const cText = commentTextByPost[p.id] ?? '';
          const isCreatingC = !!creatingComment[p.id];

          return (
            <article
              key={p.id}
              style={{
                ...cardStyle,
                marginTop: 16,
              }}
            >
              <div style={sectionPadding}>
                <div style={{ display: 'grid', gap: 8 }}>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                    <b style={{ color: '#fff' }}>ID:</b> {p.id}
                  </div>
                  <div style={{ fontSize: 14, color: '#fff' }}>
                    <b>Texto:</b> {p.text}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                    <b style={{ color: '#fff' }}>Group:</b> {p.groupId}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                    <b style={{ color: '#fff' }}>Autor:</b> {p.authorId}
                  </div>
                  <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.78)' }}>
                    <b style={{ color: '#fff' }}>Deleted:</b> {String(p.isDeleted)}
                  </div>
                </div>

                <button onClick={() => softDeletePost(p.id)} style={dangerButton}>
                  Eliminar (soft)
                </button>

                <div
                  style={{
                    marginTop: 18,
                    paddingTop: 18,
                    borderTop: '1px solid rgba(255,255,255,0.14)',
                  }}
                >
                  <h4
                    style={{
                      margin: 0,
                      fontSize: 16,
                      fontWeight: 600,
                    }}
                  >
                    Comentarios
                  </h4>

                  <div style={{ marginTop: 8 }}>
                    <button
                      onClick={() => fetchComments(p.id)}
                      disabled={isLoading}
                      style={{
                        ...secondaryButton,
                        marginTop: 0,
                        background: isLoading ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.08)',
                        cursor: isLoading ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {isLoading ? 'Cargando...' : 'Cargar comentarios'}
                    </button>
                  </div>

                  {comments !== null && comments.length === 0 && (
                    <p
                      style={{
                        marginTop: 10,
                        marginBottom: 0,
                        fontSize: 13,
                        color: 'rgba(255,255,255,0.78)',
                      }}
                    >
                      Aún no hay comentarios.
                    </p>
                  )}

                  {comments !== null && comments.length > 0 && (
                    <div style={{ marginTop: 10, display: 'grid', gap: 10 }}>
                      {comments.map((c) => (
                        <div
                          key={c.id}
                          style={{
                            padding: 12,
                            borderRadius: 12,
                            border: '1px solid rgba(255,255,255,0.14)',
                            background: 'rgba(255,255,255,0.03)',
                          }}
                        >
                          <div
                            style={{
                              fontSize: 12,
                              color: 'rgba(255,255,255,0.72)',
                            }}
                          >
                            <b style={{ color: '#fff' }}>Autor:</b> {c.authorId}
                          </div>
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 14,
                              color: '#fff',
                            }}
                          >
                            {c.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div
                    style={{
                      marginTop: 14,
                      padding: 14,
                      borderRadius: 12,
                      border: '1px solid rgba(255,255,255,0.14)',
                      background: 'rgba(255,255,255,0.03)',
                    }}
                  >
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: '#fff',
                      }}
                    >
                      Agregar comentario
                    </div>

                    <input
                      value={cText}
                      onChange={(e) =>
                        setCommentTextByPost((prev) => ({
                          ...prev,
                          [p.id]: e.target.value,
                        }))
                      }
                      placeholder="Escribe un comentario..."
                      style={inputStyle}
                    />

                    <button
                      onClick={() => createComment(p.id)}
                      disabled={isCreatingC || cText.trim().length === 0}
                      style={{
                        ...primaryButton,
                        background:
                          isCreatingC || cText.trim().length === 0
                            ? 'rgba(255,255,255,0.15)'
                            : '#fff',
                        color:
                          isCreatingC || cText.trim().length === 0 ? '#fff' : '#000',
                        cursor:
                          isCreatingC || cText.trim().length === 0
                            ? 'not-allowed'
                            : 'pointer',
                      }}
                    >
                      {isCreatingC ? 'Comentando...' : 'Comentar'}
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}