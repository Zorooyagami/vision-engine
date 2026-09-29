const {
  createProject,
  listProjects,
  getProjectById,
  updateProject,
  deleteProject,
} = require(
  '../services/projectService'
)

/* -------------------------------------------------------
   POST /api/admin/projects
------------------------------------------------------- */

async function createProjectHandler(
  req,
  res
) {
  try {
    const {
      name,
      websiteUrl,
      description,
      allowedOrigins,
      settings,
    } = req.body

    /*
     * Once you have authentication:
     *
     * const ownerId = req.user.id
     *
     * For now this can stay null.
     */
    const ownerId =
      req.user?.id || null

    const project =
      await createProject({
        name,
        websiteUrl,
        description,
        allowedOrigins,
        settings,
        ownerId,
      })

    res.status(201).json({
      project,
    })
  } catch (err) {
    console.error(
      '[projects/create] failed:',
      err
    )

    /*
     * Validation-type errors.
     */
    if (
      err.message ===
        'Project name is required' ||
      err.message ===
        'Website URL is required' ||
      err.message ===
        'Invalid website URL'
    ) {
      return res
        .status(400)
        .json({
          error: err.message,
        })
    }

    res.status(500).json({
      error:
        'Failed to create project',
    })
  }
}

/* -------------------------------------------------------
   GET /api/admin/projects
------------------------------------------------------- */

async function listProjectsHandler(
  req,
  res
) {
  try {
    const ownerId =
      req.user?.id || null

    const projects =
      await listProjects({
        ownerId,
      })

    res.json({
      projects,
    })
  } catch (err) {
    console.error(
      '[projects/list] failed:',
      err
    )

    res.status(500).json({
      error:
        'Failed to list projects',
    })
  }
}

/* -------------------------------------------------------
   GET /api/admin/projects/:projectId
------------------------------------------------------- */

async function getProjectHandler(
  req,
  res
) {
  try {
    const {
      projectId,
    } = req.params

    const project =
      await getProjectById(
        projectId
      )

    if (!project) {
      return res
        .status(404)
        .json({
          error:
            'Project not found',
        })
    }

    /*
     * Later:
     *
     * verify req.user has access
     * to this project.
     */

    res.json({
      project,
    })
  } catch (err) {
    console.error(
      '[projects/get] failed:',
      err
    )

    res.status(500).json({
      error:
        'Failed to load project',
    })
  }
}

/* -------------------------------------------------------
   PATCH /api/admin/projects/:projectId
------------------------------------------------------- */

async function updateProjectHandler(
  req,
  res
) {
  try {
    const {
      projectId,
    } = req.params

    /*
     * Do NOT pass arbitrary req.body
     * directly into Mongo.
     *
     * Explicitly whitelist fields.
     */
    const updates = {
      name:
        req.body.name,

      description:
        req.body.description,

      websiteUrl:
        req.body.websiteUrl,

      allowedOrigins:
        req.body.allowedOrigins,

      settings:
        req.body.settings,

      status:
        req.body.status,
    }

    const project =
      await updateProject(
        projectId,
        updates
      )

    if (!project) {
      return res
        .status(404)
        .json({
          error:
            'Project not found',
        })
    }

    res.json({
      project,
    })
  } catch (err) {
    console.error(
      '[projects/update] failed:',
      err
    )

    if (
      err.message ===
        'Project name cannot be empty' ||
      err.message ===
        'Invalid website URL' ||
      err.message ===
        'Invalid project status'
    ) {
      return res
        .status(400)
        .json({
          error: err.message,
        })
    }

    res.status(500).json({
      error:
        'Failed to update project',
    })
  }
}

/* -------------------------------------------------------
   DELETE /api/admin/projects/:projectId
------------------------------------------------------- */

async function deleteProjectHandler(
  req,
  res
) {
  try {
    const {
      projectId,
    } = req.params

    const project =
      await deleteProject(
        projectId
      )

    if (!project) {
      return res
        .status(404)
        .json({
          error:
            'Project not found',
        })
    }

    res.json({
      success: true,
      projectId,
    })
  } catch (err) {
    console.error(
      '[projects/delete] failed:',
      err
    )

    res.status(500).json({
      error:
        'Failed to delete project',
    })
  }
}

module.exports = {
  createProjectHandler,
  listProjectsHandler,
  getProjectHandler,
  updateProjectHandler,
  deleteProjectHandler,
}