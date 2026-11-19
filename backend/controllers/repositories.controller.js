import db from '../config/db.js';

/**
 * GET /api/repositories
 * Lista los repositorios visibles según el rol y departamento del usuario.
 * - ADMIN: todos los repositorios.
 * - SUPERVISOR / AGENTE: propios + repositorio oficial "Normativa PQRS" + su departamento.
 * - LEGAL / FINANCIERO / RECLUTADOR: aislamiento estricto a su departamento y repositorios propios.
 */
export async function listarRepositorios(req, res) {
  try {
    let sql, params;
    const rolUsuario = (req.user?.rol || '').toUpperCase();
    const usuarioId = req.user?.id ?? null;

    if (rolUsuario === 'ADMIN') {
      sql = `
        SELECT r.*, u.nombre AS creado_por, 
               COUNT(d.id) AS total_documentos
        FROM repositorios r
        JOIN usuarios u ON r.usuario_id = u.id
        LEFT JOIN documentos d ON r.id = d.repositorio_id
        GROUP BY r.id, u.nombre
        ORDER BY r.creado_en DESC
      `;
      params = [];
    } else if (rolUsuario === 'SUPERVISOR' || rolUsuario === 'AGENTE') {
      // Acceso operativo de lectura: repositorios propios, el repositorio oficial
      // "Normativa PQRS" y los repositorios del departamento del funcionario.
      // Nunca se abre acceso global a departamentos privados ajenos.
      const deptoUsuario = req.user?.departamento || null;
      const condiciones = [
        'r.usuario_id = ?',
        "r.slug = 'normativa-pqrs'",
        "r.departamento = 'Normativa PQRS'",
      ];
      params = [usuarioId];

      if (deptoUsuario) {
        condiciones.push('r.departamento = ?');
        params.push(deptoUsuario);
      }

      sql = `
        SELECT r.*, u.nombre AS creado_por,
               COUNT(d.id) AS total_documentos
        FROM repositorios r
        JOIN usuarios u ON r.usuario_id = u.id
        LEFT JOIN documentos d ON r.id = d.repositorio_id
        WHERE (${condiciones.join(' OR ')})
        GROUP BY r.id, u.nombre
        ORDER BY r.creado_en DESC
      `;
    } else {
      let depto = null;
      if (rolUsuario === 'LEGAL') depto = 'Legal';
      else if (rolUsuario === 'FINANCIERO') depto = 'Financiero';
      else if (rolUsuario === 'RECLUTADOR') depto = 'Recursos Humanos';

      if (depto) {
        sql = `
          SELECT r.*, u.nombre AS creado_por,
                 COUNT(d.id) AS total_documentos
          FROM repositorios r
          JOIN usuarios u ON r.usuario_id = u.id
          LEFT JOIN documentos d ON r.id = d.repositorio_id
          WHERE r.departamento = ? OR r.usuario_id = ?
          GROUP BY r.id, u.nombre
          ORDER BY r.creado_en DESC
        `;
        params = [depto, usuarioId];
      } else {
        sql = `
          SELECT r.*, u.nombre AS creado_por,
                 COUNT(d.id) AS total_documentos
          FROM repositorios r
          JOIN usuarios u ON r.usuario_id = u.id
          LEFT JOIN documentos d ON r.id = d.repositorio_id
          WHERE r.usuario_id = ?
          GROUP BY r.id, u.nombre
          ORDER BY r.creado_en DESC
        `;
        params = [usuarioId];
      }
    }

    const repositorios = await db.query(sql, params);
    return res.status(200).json({ ok: true, repositorios });
  } catch (error) {
    console.error('Error al listar repositorios:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error al obtener repositorios.' });
  }
}

/**
 * POST /api/repositories
 * Crea un nuevo repositorio (carpeta lógica) asociado al usuario autenticado.
 */
export async function crearRepositorio(req, res) {
  const { nombre, descripcion, departamento } = req.body;

  if (!nombre || !departamento) {
    return res.status(400).json({
      ok: false,
      mensaje: 'Los campos nombre y departamento son requeridos.',
    });
  }

  try {
    const result = await db.query(
      'INSERT INTO repositorios (nombre, descripcion, departamento, usuario_id) VALUES (?, ?, ?, ?)',
      [nombre, descripcion || null, departamento, req.user.id]
    );

    const [nuevoRepo] = await db.query('SELECT * FROM repositorios WHERE id = ?', [result.insertId]);

    return res.status(201).json({
      ok: true,
      mensaje: 'Repositorio creado exitosamente.',
      repositorio: nuevoRepo,
    });
  } catch (error) {
    console.error('Error al crear repositorio:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error al crear el repositorio.' });
  }
}

/**
 * DELETE /api/repositories/:id
 * Elimina un repositorio (y en cascada sus documentos en MySQL).
 * Solo ADMIN puede eliminar.
 */
export async function eliminarRepositorio(req, res) {
  const { id } = req.params;

  try {
    const rows = await db.query('SELECT * FROM repositorios WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, mensaje: 'Repositorio no encontrado.' });
    }

    await db.query('DELETE FROM repositorios WHERE id = ?', [id]);

    return res.status(200).json({
      ok: true,
      mensaje: `Repositorio '${rows[0].nombre}' eliminado. Los documentos asociados fueron eliminados en cascada.`,
    });
  } catch (error) {
    console.error('Error al eliminar repositorio:', error);
    return res.status(500).json({ ok: false, mensaje: 'Error al eliminar el repositorio.' });
  }
}
