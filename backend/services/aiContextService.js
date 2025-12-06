import { pool as db } from '../config/database.js';

const CONNECTOR_DEFINITIONS = {
  'super-admin': [
    {
      key: 'org_overview',
      label: 'Organization Overview',
      description: 'Summaries for colleges, faculty, students, and submissions across the network.',
      sampleQuestions: [
        'How many assessments were published this month?',
        'Are we growing the number of active students?'
      ]
    },
    {
      key: 'risk_alerts',
      label: 'Risk & Compliance Alerts',
      description: 'Highlights of low-performing cohorts and potential compliance issues.',
      sampleQuestions: [
        'Which colleges have the most students below 60%?',
        'Where do we need interventions right now?'
      ]
    },
    {
      key: 'engagement_summary',
      label: 'Engagement Summary',
      description: 'Recent activity trends across top colleges.',
      sampleQuestions: [
        'Which colleges drove submissions last week?',
        'Who needs nudges to improve engagement?'
      ]
    }
  ],
  'college-admin': [
    {
      key: 'college_overview',
      label: 'College Health',
      description: 'Faculty, student, and assessment stats scoped to your college.',
      sampleQuestions: [
        'How many assessments are live for my college?',
        'What does student participation look like?'
      ]
    },
    {
      key: 'college_risk_students',
      label: 'At-Risk Students',
      description: 'Students with sustained low performance over the past month.',
      sampleQuestions: [
        'Who needs extra mentoring?',
        'Which departments require interventions?'
      ]
    }
  ],
  faculty: [
    {
      key: 'faculty_pipeline',
      label: 'Assessment Pipeline',
      description: 'Snapshot of assessments you created and their progress.',
      sampleQuestions: [
        'Which assessments need publishing?',
        'How many students attempted my latest exam?'
      ]
    },
    {
      key: 'grading_queue',
      label: 'Grading Queue',
      description: 'Pending submissions that still require manual grading.',
      sampleQuestions: [
        'What should I grade next?',
        'Any submissions waiting for review?'
      ]
    }
  ],
  student: [
    {
      key: 'student_performance',
      label: 'My Performance',
      description: 'Recent attempts, grades, and improvement trends for you.',
      sampleQuestions: [
        'How am I performing overall?',
        'Where can I improve next?'
      ]
    },
    {
      key: 'student_active_sessions',
      label: 'Active Sessions',
      description: 'Assessments currently in-progress or waiting for your action.',
      sampleQuestions: [
        'Do I have incomplete tests?',
        'What deadlines are approaching?'
      ]
    }
  ]
};

class AiContextService {
  normalizeRole(role = '') {
    return role.replace('_', '-').toLowerCase();
  }

  getConnectorsForRole(role) {
    const normalized = this.normalizeRole(role);
    return CONNECTOR_DEFINITIONS[normalized] || [];
  }

  ensureConnectorAccess(role, connectorKey) {
    const connectors = this.getConnectorsForRole(role);
    const connector = connectors.find((item) => item.key === connectorKey);
    if (!connector) {
      const error = new Error('Connector not available for this role');
      error.statusCode = 403;
      throw error;
    }
    return connector;
  }

  async getContextForConnector(user, connectorKey, params = {}) {
    const normalizedRole = this.normalizeRole(user.role);
    this.ensureConnectorAccess(normalizedRole, connectorKey);

    switch (connectorKey) {
      case 'org_overview':
        return this.getOrgOverview();
      case 'risk_alerts':
        return this.getSystemRiskAlerts();
      case 'engagement_summary':
        return this.getEngagementSummary();
      case 'college_overview':
        return this.getCollegeOverview(user.college_id);
      case 'college_risk_students':
        return this.getCollegeRiskStudents(user.college_id);
      case 'faculty_pipeline':
        return this.getFacultyPipeline(user.id);
      case 'grading_queue':
        return this.getFacultyGradingQueue(user.id, params.limit);
      case 'student_performance':
        return this.getStudentPerformance(user.id);
      case 'student_active_sessions':
        return this.getStudentActiveSessions(user.id);
      default:
        throw new Error('Unsupported connector');
    }
  }

  async getOrgOverview() {
    const [overviewRows] = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM colleges WHERE is_active = true) AS totalColleges,
        (SELECT COUNT(*) FROM departments WHERE is_active = true) AS totalDepartments,
        (SELECT COUNT(*) FROM users WHERE role = 'faculty') AS facultyCount,
        (SELECT COUNT(*) FROM users WHERE role = 'student') AS studentCount,
        (SELECT COUNT(*) FROM assessments WHERE is_published = true) AS publishedAssessments,
        (SELECT COUNT(*) FROM assessment_submissions) AS totalSubmissions
    `);

    // Calculate date on application side - PostgreSQL compatible
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
    const sixMonthsAgoStr = sixMonthsAgo.toISOString();
    
    const [trendRows] = await db.execute(`
      SELECT TO_CHAR(submitted_at, 'YYYY-MM') AS period, COUNT(*) AS submissions
      FROM assessment_submissions
      WHERE submitted_at >= ?
      GROUP BY TO_CHAR(submitted_at, 'YYYY-MM')
      ORDER BY period ASC
    `, [sixMonthsAgoStr]);

    return {
      ...overviewRows[0],
      submissionTrend: trendRows
    };
  }

  async getSystemRiskAlerts() {
    const [riskRows] = await db.execute(`
      SELECT
        u.id,
        u.name,
        u.email,
        u.college_id AS collegeId,
        AVG(s.percentage_score) AS avgPercentage,
        COUNT(*) AS attemptsLast30Days
      FROM assessment_submissions s
      JOIN users u ON u.id = s.student_id
      WHERE s.submitted_at >= NOW() - INTERVAL '30 days'
      GROUP BY u.id, u.name, u.email, u.college_id
      HAVING avgPercentage < 60 AND attemptsLast30Days >= 2
      ORDER BY avgPercentage ASC
      LIMIT 8
    `);

    return {
      generatedAt: new Date().toISOString(),
      atRiskStudents: riskRows
    };
  }

  async getEngagementSummary() {
    const [rows] = await db.execute(`
      SELECT
        c.id AS collegeId,
        c.name AS collegeName,
        COUNT(DISTINCT at.id) AS publishedAssessments,
        COUNT(DISTINCT CASE
          WHEN s.submitted_at >= NOW() - INTERVAL '30 days' THEN s.id
        END) AS submissionsLast30Days
      FROM colleges c
      LEFT JOIN assessments at ON at.college_id = c.id AND at.is_published = true
      LEFT JOIN assessment_submissions s ON s.assessment_id = at.id
      GROUP BY c.id, c.name
      ORDER BY submissionsLast30Days DESC
      LIMIT 5
    `);

    return {
      generatedAt: new Date().toISOString(),
      topColleges: rows
    };
  }

  async getCollegeOverview(collegeId) {
    if (!collegeId) {
      const error = new Error('College context is required for this connector');
      error.statusCode = 400;
      throw error;
    }

    const [overviewRows] = await db.execute(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'faculty') AS facultyCount,
        (SELECT COUNT(*) FROM users WHERE college_id = ? AND role = 'student') AS studentCount,
        (SELECT COUNT(*) FROM assessments WHERE college_id = ? AND is_published = true) AS publishedAssessments,
        (SELECT COUNT(*) FROM assessment_submissions sub
          JOIN assessments at2 ON at2.id = sub.assessment_id
          WHERE at2.college_id = ?) AS totalSubmissions
    `, [collegeId, collegeId, collegeId, collegeId]);

    const [departments] = await db.execute(`
      SELECT
        department AS departmentName,
        COUNT(*) AS publishedAssessments
      FROM assessments
      WHERE college_id = ? AND is_published = true
      GROUP BY department
      ORDER BY publishedAssessments DESC
    `, [collegeId]);

    return {
      ...(overviewRows[0] || {}),
      departmentBreakdown: departments
    };
  }

  async getCollegeRiskStudents(collegeId) {
    if (!collegeId) {
      const error = new Error('College context is required for this connector');
      error.statusCode = 400;
      throw error;
    }

    const [rows] = await db.execute(`
      SELECT
        u.id,
        u.name,
        u.email,
        COALESCE(u.department, 'Unassigned') AS departmentName,
        COUNT(*) AS attemptsLast30Days,
        AVG(s.percentage_score) AS avgPercentage
      FROM assessment_submissions s
      JOIN users u ON u.id = s.student_id
      JOIN assessments at ON at.id = s.assessment_id
      WHERE at.college_id = ?
        AND s.submitted_at >= NOW() - INTERVAL '30 days'
      GROUP BY u.id, u.name, u.email, departmentName
      HAVING avgPercentage < 65
      ORDER BY avgPercentage ASC
      LIMIT 10
    `, [collegeId]);

    return {
      generatedAt: new Date().toISOString(),
      students: rows
    };
  }

  async getFacultyPipeline(userId) {
    const [overviewRows] = await db.execute(`
      SELECT
        COUNT(*) AS totalAssessments,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) AS drafts,
        SUM(CASE WHEN is_published = true THEN 1 ELSE 0 END) AS published,
        SUM(CASE WHEN status = 'archived' THEN 1 ELSE 0 END) AS archived
      FROM assessments
      WHERE created_by = ?
    `, [userId]);

    const [recentAssessments] = await db.execute(`
      SELECT
        at.id,
        at.title,
        at.status,
        at.total_points AS totalPoints,
        at.created_at AS createdAt,
        COUNT(DISTINCT s.id) AS submissionCount
      FROM assessments at
      LEFT JOIN assessment_submissions s ON s.assessment_id = at.id
      WHERE at.created_by = ?
      GROUP BY at.id, at.title, at.status, at.total_points, at.created_at
      ORDER BY at.updated_at DESC
      LIMIT 5
    `, [userId]);

    return {
      ...(overviewRows[0] || {}),
      recentAssessments
    };
  }

  async getFacultyGradingQueue(userId, limit = 5) {
    const safeLimit = Math.min(Math.max(parseInt(limit, 10) || 5, 1), 20);

    const [rows] = await db.execute(`
      SELECT
        s.id AS submissionId,
        s.assessment_id AS assessmentId,
        at.title AS assessmentTitle,
        u.name AS studentName,
        s.submitted_at AS submittedAt,
        s.status
      FROM assessment_submissions s
      JOIN assessments at ON at.id = s.assessment_id
      JOIN users u ON u.id = s.student_id
      WHERE at.created_by = ?
        AND s.status IN ('submitted', 'late')
      ORDER BY s.submitted_at ASC
      LIMIT ?
    `, [userId, safeLimit]);

    return {
      pendingReviews: rows.length,
      submissions: rows
    };
  }

  async getStudentPerformance(userId) {
    const [metricsRows] = await db.execute(`
      SELECT
        COUNT(*) AS totalAttempts,
        SUM(CASE WHEN status IN ('submitted', 'graded', 'completed') THEN 1 ELSE 0 END) AS completedAttempts,
        ROUND(AVG(percentage_score), 2) AS averagePercentage,
        MAX(submitted_at) AS lastSubmission
      FROM assessment_submissions
      WHERE student_id = ?
    `, [userId]);

    const [recentAttempts] = await db.execute(`
      SELECT
        s.assessment_id AS assessmentId,
        at.title AS assessmentTitle,
        s.percentage_score AS percentageScore,
        s.status,
        s.submitted_at AS submittedAt
      FROM assessment_submissions s
      JOIN assessments at ON at.id = s.assessment_id
      WHERE s.student_id = ?
      ORDER BY s.submitted_at DESC
      LIMIT 5
    `, [userId]);

    return {
      ...(metricsRows[0] || {}),
      recentAttempts
    };
  }

  async getStudentActiveSessions(userId) {
    const [rows] = await db.execute(`
      SELECT
        s.id AS submissionId,
        s.assessment_id AS assessmentId,
        at.title AS assessmentTitle,
        s.status,
        s.started_at AS startedAt,
        s.submitted_at AS submittedAt
      FROM assessment_submissions s
      JOIN assessments at ON at.id = s.assessment_id
      WHERE s.student_id = ?
        AND s.status IN ('in_progress', 'submitted', 'late')
      ORDER BY s.started_at DESC
      LIMIT 5
    `, [userId]);

    return {
      activeSessions: rows
    };
  }
}

export default new AiContextService();

