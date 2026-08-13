export type Language = "en" | "br";

export interface Translations {
  errors: {
    /** The request never reached a response — network, DNS, abort. */
    requestFailed: string;
    /** An error body was present but not in a shape we could read. */
    invalidErrorFormat: string;
    /** A body arrived but could not be parsed. */
    parseFailed: string;
    /** The server answered with an error status and no message of its own. */
    requestRejected: string;
  };
  builder: {
    hostRequired: string;
    routesRequired: string;
    errorHandlerRequired: string;
  };
}

const translations: Record<Language, Translations> = {
  en: {
    errors: {
      requestFailed: "Unable to complete the request",
      invalidErrorFormat: "Invalid error message format",
      parseFailed: "Unable to parse the response body",
      requestRejected: "The server rejected the request"
    },
    builder: {
      hostRequired: "Host is required - use .withHost() first",
      routesRequired: "Routes are required - use .withRoutes() first",
      errorHandlerRequired: "Error handler is required - use .withApiError() first"
    }
  },
  br: {
    errors: {
      requestFailed: "Não foi possível completar a requisição",
      invalidErrorFormat: "Formato de mensagem de erro inválido",
      parseFailed: "Não foi possível interpretar o corpo da resposta",
      requestRejected: "O servidor rejeitou a requisição"
    },
    builder: {
      hostRequired: "Host é obrigatório - use .withHost() primeiro",
      routesRequired: "Rotas são obrigatórias - use .withRoutes() primeiro",
      errorHandlerRequired: "Manipulador de erro é obrigatório - use .withApiError() primeiro"
    }
  }
};

export function getTranslations(language: Language = "en"): Translations {
  return translations[language];
}

export function t(language: Language = "en"): Translations {
  return getTranslations(language);
}
