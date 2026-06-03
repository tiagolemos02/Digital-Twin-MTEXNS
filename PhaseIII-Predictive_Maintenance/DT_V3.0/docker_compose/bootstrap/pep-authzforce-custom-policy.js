#!/usr/bin/env node

const xml2json = require('xml2json');
const escapeXML = require('escape-html');

function lisbonClockParts(now) {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Lisbon',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = formatter.formatToParts(now);
  const map = {};

  for (const part of parts) {
    map[part.type] = part.value;
  }

  const weekday = (map.weekday || '').replace('.', '');
  const time = `${map.hour || '00'}:${map.minute || '00'}:${map.second || '00'}`;

  return { weekday, time };
}

exports.getPolicy = function (roles, req, appId) {
  const action = String(req.method || '').toUpperCase();
  const resource = escapeXML(req.originalUrl || req.url || '/');
  const nowLisbon = lisbonClockParts(new Date());

  const xacmlRequest = {
    Request: {
      xmlns: 'urn:oasis:names:tc:xacml:3.0:core:schema:wd-17',
      CombinedDecision: 'false',
      ReturnPolicyIdList: 'false',
      Attributes: [
        {
          Category: 'urn:oasis:names:tc:xacml:1.0:subject-category:access-subject',
          Attribute: []
        },
        {
          Category: 'urn:oasis:names:tc:xacml:3.0:attribute-category:resource',
          Attribute: [
            {
              AttributeId: 'urn:oasis:names:tc:xacml:1.0:resource:resource-id',
              IncludeInResult: 'false',
              AttributeValue: {
                DataType: 'http://www.w3.org/2001/XMLSchema#string',
                $t: appId
              }
            },
            {
              AttributeId: 'urn:thales:xacml:2.0:resource:sub-resource-id',
              IncludeInResult: 'false',
              AttributeValue: {
                DataType: 'http://www.w3.org/2001/XMLSchema#string',
                $t: resource
              }
            }
          ]
        },
        {
          Category: 'urn:oasis:names:tc:xacml:3.0:attribute-category:action',
          Attribute: {
            AttributeId: 'urn:oasis:names:tc:xacml:1.0:action:action-id',
            IncludeInResult: 'false',
            AttributeValue: {
              DataType: 'http://www.w3.org/2001/XMLSchema#string',
              $t: action
            }
          }
        },
        {
          Category: 'urn:oasis:names:tc:xacml:3.0:attribute-category:environment',
          Attribute: [
            {
              AttributeId: 'urn:fiware:environment:lisbon-weekday',
              IncludeInResult: 'false',
              AttributeValue: {
                DataType: 'http://www.w3.org/2001/XMLSchema#string',
                $t: nowLisbon.weekday
              }
            },
            {
              AttributeId: 'urn:fiware:environment:lisbon-time',
              IncludeInResult: 'false',
              AttributeValue: {
                DataType: 'http://www.w3.org/2001/XMLSchema#time',
                $t: nowLisbon.time
              }
            }
          ]
        }
      ]
    }
  };

  if (roles.length > 0) {
    xacmlRequest.Request.Attributes[0].Attribute[0] = {
      AttributeId: 'urn:oasis:names:tc:xacml:2.0:subject:role',
      IncludeInResult: 'false',
      AttributeValue: []
    };

    for (const i in roles) {
      xacmlRequest.Request.Attributes[0].Attribute[0].AttributeValue[i] = {
        DataType: 'http://www.w3.org/2001/XMLSchema#string',
        $t: roles[i]
      };
    }
  }

  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + xml2json.toXml(xacmlRequest);
};
