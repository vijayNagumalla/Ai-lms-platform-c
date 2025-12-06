import aiContextService from '../services/aiContextService.js';
import geminiService from '../services/geminiService.js';

export const getRoleConnectors = async (req, res) => {
  try {
    const connectors = aiContextService.getConnectorsForRole(req.user.role);
    return res.json({
      success: true,
      data: connectors
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to load connectors'
    });
  }
};

export const fetchConnectorContext = async (req, res) => {
  try {
    const { connectorKey, params = {} } = req.body || {};
    if (!connectorKey) {
      return res.status(400).json({
        success: false,
        message: 'connectorKey is required'
      });
    }

    const payload = await aiContextService.getContextForConnector(req.user, connectorKey, params);
    return res.json({
      success: true,
      data: payload,
      connectorKey
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to load context'
    });
  }
};

export const chatWithGemini = async (req, res) => {
  try {
    const { message, history = [], context = [], options = {} } = req.body || {};

    if (!message) {
      return res.status(400).json({
        success: false,
        message: 'Message is required'
      });
    }

    const response = await geminiService.generateResponse({
      user: req.user,
      message,
      history,
      contextBlocks: context,
      options
    });

    return res.json({
      success: true,
      data: response
    });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || 'Failed to generate response'
    });
  }
};

