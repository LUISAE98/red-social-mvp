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

      // Limpieza local opcional (para que no queden comments en memoria)
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

  return (
    <main style={{ padding: 16 }}>
      <h1>Test Posts</h1>

      <p style={{ fontSize: 12, opacity: 0.8 }}>
        UID actual: {uid ?? 'no hay sesión'}
      </p>

      <div style={{ marginTop: 12, padding: 12, border: '1px solid #444' }}>
        <h3>Crear post</h3>

        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Escribe algo..."
          style={{ width: '100%', padding: 8, marginTop: 8 }}
        />

        <button
          onClick={createPost}
          disabled={creating || text.trim().length === 0}
          style={{ marginTop: 8, padding: '8px 12px', cursor: 'pointer' }}
        >
          {creating ? 'Creando...' : 'Publicar'}
        </button>

        <p style={{ marginTop: 8, fontSize: 12, opacity: 0.8 }}>
          Tip: debes estar logueado en <code>/login</code> para poder publicar y comentar.
        </p>
      </div>

      {error && (
        <pre style={{ padding: 12, background: '#300', color: '#fff', marginTop: 12 }}>
          {error}
        </pre>
      )}

      {!error && posts.length === 0 && <p style={{ marginTop: 12 }}>No hay posts.</p>}

      {posts.map((p) => {
        const comments = commentsByPost[p.id] ?? null; // null = no cargados
        const isLoading = !!loadingComments[p.id];
        const cText = commentTextByPost[p.id] ?? '';
        const isCreatingC = !!creatingComment[p.id];

        return (
          <article
            key={p.id}
            style={{ border: '1px solid #444', padding: 12, marginTop: 12 }}
          >
            <div>
              <b>ID:</b> {p.id}
            </div>
            <div>
              <b>Texto:</b> {p.text}
            </div>
            <div>
              <b>Group:</b> {p.groupId}
            </div>
            <div>
              <b>Autor:</b> {p.authorId}
            </div>
            <div>
              <b>Deleted:</b> {String(p.isDeleted)}
            </div>

            <button
              onClick={() => softDeletePost(p.id)}
              style={{ marginTop: 8, padding: '6px 10px', cursor: 'pointer' }}
            >
              Eliminar (soft)
            </button>

            {/* --- Comentarios --- */}
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid #444' }}>
              <h4 style={{ margin: 0 }}>Comentarios</h4>

              <div style={{ marginTop: 8 }}>
                <button
                  onClick={() => fetchComments(p.id)}
                  disabled={isLoading}
                  style={{ padding: '6px 10px', cursor: 'pointer' }}
                >
                  {isLoading ? 'Cargando...' : 'Cargar comentarios'}
                </button>
              </div>

              {comments !== null && comments.length === 0 && (
                <p style={{ marginTop: 8, opacity: 0.8 }}>Aún no hay comentarios.</p>
              )}

              {comments !== null && comments.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  {comments.map((c) => (
                    <div
                      key={c.id}
                      style={{ padding: 8, border: '1px solid #333', marginTop: 8 }}
                    >
                      <div style={{ fontSize: 12, opacity: 0.8 }}>
                        <b>Autor:</b> {c.authorId}
                      </div>
                      <div style={{ marginTop: 4 }}>{c.text}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ marginTop: 12, padding: 10, border: '1px solid #333' }}>
                <b>Agregar comentario</b>
                <input
                  value={cText}
                  onChange={(e) =>
                    setCommentTextByPost((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  placeholder="Escribe un comentario..."
                  style={{ width: '100%', padding: 8, marginTop: 8 }}
                />
                <button
                  onClick={() => createComment(p.id)}
                  disabled={isCreatingC || cText.trim().length === 0}
                  style={{ marginTop: 8, padding: '6px 10px', cursor: 'pointer' }}
                >
                  {isCreatingC ? 'Comentando...' : 'Comentar'}
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </main>
  );
}
