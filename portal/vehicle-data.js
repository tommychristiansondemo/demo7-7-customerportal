/**
 * Nissan US Vehicle Data — Model/Year/Trim cascading dropdown data.
 *
 * Structure: { modelName: { years: [start, end], trims: { year: [trims] } } }
 * Where trims is keyed by year or year-range pattern.
 *
 * This is a representative dataset for demonstration purposes.
 * Not an exhaustive catalog of every trim offered.
 */

window.NISSAN_VEHICLE_DATA = {
  'Altima': {
    years: [2002, 2026],
    trims: {
      '2002-2006': ['2.5', '2.5 S', '3.5 SE', '3.5 SL'],
      '2007-2012': ['2.5', '2.5 S', '2.5 SL', '3.5 SR', '3.5 SV'],
      '2013-2018': ['2.5', '2.5 S', '2.5 SV', '2.5 SL', '3.5 S', '3.5 SV', '3.5 SL', '3.5 SR'],
      '2019-2023': ['S', 'SV', 'SR', 'SL', 'Platinum', 'SR VC-Turbo', 'SL VC-Turbo'],
      '2024-2026': ['S', 'SV', 'SR', 'SL', 'Platinum', 'SR VC-Turbo'],
    }
  },
  'Armada': {
    years: [2004, 2026],
    trims: {
      '2004-2007': ['SE', 'SE Off-Road', 'LE'],
      '2008-2015': ['SV', 'SL', 'Platinum'],
      '2016': ['SV', 'SL', 'Platinum', 'Platinum Reserve'],
      '2017-2020': ['SV', 'SL', 'Platinum', 'Platinum Reserve'],
      '2021-2023': ['S', 'SV', 'SL', 'Platinum', 'Midnight Edition'],
      '2024-2026': ['S', 'SV', 'SL', 'Platinum', 'Midnight Edition'],
    }
  },
  'Frontier': {
    years: [2005, 2026],
    trims: {
      '2005-2012': ['XE', 'SE', 'SV', 'SL', 'PRO-4X', 'Nismo'],
      '2013-2019': ['S', 'SV', 'SL', 'Desert Runner', 'PRO-4X'],
      '2020-2021': ['S', 'SV', 'PRO-4X'],
      '2022-2026': ['S', 'SV', 'PRO-4X', 'PRO-X'],
    }
  },
  'GT-R': {
    years: [2009, 2024],
    trims: {
      '2009-2011': ['Base', 'Premium'],
      '2012-2016': ['Base', 'Premium', 'Black Edition', 'Track Edition', 'Nismo'],
      '2017-2024': ['Premium', 'T-spec', 'Nismo', 'Nismo Special Edition'],
    }
  },
  'Kicks': {
    years: [2018, 2026],
    trims: {
      '2018-2020': ['S', 'SV', 'SR'],
      '2021-2023': ['S', 'SV', 'SR'],
      '2024-2026': ['S', 'SV', 'SR'],
    }
  },
  'LEAF': {
    years: [2011, 2024],
    trims: {
      '2011-2012': ['SV', 'SL'],
      '2013-2017': ['S', 'SV', 'SL'],
      '2018-2021': ['S', 'SV', 'SL', 'S Plus', 'SV Plus', 'SL Plus'],
      '2022-2024': ['S', 'SV Plus', 'SL Plus'],
    }
  },
  'Maxima': {
    years: [2004, 2023],
    trims: {
      '2004-2008': ['SE', 'SL'],
      '2009-2014': ['S', 'SV', 'Sport'],
      '2015-2019': ['S', 'SV', 'SL', 'SR', 'Platinum', 'Platinum Reserve'],
      '2020-2023': ['SV', 'SR', 'Platinum', '40th Anniversary Edition'],
    }
  },
  'Murano': {
    years: [2003, 2026],
    trims: {
      '2003-2007': ['S', 'SL', 'SE'],
      '2008-2014': ['S', 'SV', 'SL', 'LE', 'CrossCabriolet'],
      '2015-2020': ['S', 'SV', 'SL', 'Platinum'],
      '2021-2024': ['S', 'SV', 'SL', 'Platinum'],
      '2025-2026': ['S', 'SV', 'SL', 'Platinum'],
    }
  },
  'Pathfinder': {
    years: [2005, 2026],
    trims: {
      '2005-2012': ['S', 'SE', 'SE Off-Road', 'LE', 'Silver Edition'],
      '2013-2016': ['S', 'SV', 'SL', 'Platinum', 'Hybrid'],
      '2017-2020': ['S', 'SV', 'SL', 'Platinum', 'Rock Creek'],
      '2022-2026': ['S', 'SV', 'SL', 'Platinum', 'Rock Creek'],
    }
  },
  'Rogue': {
    years: [2008, 2026],
    trims: {
      '2008-2013': ['S', 'SV', 'SL'],
      '2014-2020': ['S', 'SV', 'SL', 'Platinum'],
      '2021-2023': ['S', 'SV', 'SL', 'Platinum'],
      '2024-2026': ['S', 'SV', 'SL', 'Platinum', 'Rock Creek'],
    }
  },
  'Rogue Sport': {
    years: [2017, 2022],
    trims: {
      '2017-2022': ['S', 'SV', 'SL'],
    }
  },
  'Sentra': {
    years: [2000, 2026],
    trims: {
      '2000-2006': ['XE', 'GXE', 'SE-R', 'SE-R Spec V', '1.8', '1.8 S'],
      '2007-2012': ['2.0', '2.0 S', '2.0 SL', 'SE-R', 'SE-R Spec V', 'SR'],
      '2013-2019': ['S', 'SV', 'SR', 'SL', 'SR Turbo', 'Nismo'],
      '2020-2023': ['S', 'SV', 'SR', 'SL'],
      '2024-2026': ['S', 'SV', 'SR', 'SL'],
    }
  },
  'Titan': {
    years: [2004, 2026],
    trims: {
      '2004-2015': ['S', 'SV', 'SL', 'PRO-4X'],
      '2016-2019': ['S', 'SV', 'SL', 'Platinum Reserve', 'PRO-4X', 'XD'],
      '2020-2023': ['S', 'SV', 'SL', 'Platinum Reserve', 'PRO-4X'],
      '2024-2026': ['S', 'SV', 'SL', 'Platinum Reserve', 'PRO-4X'],
    }
  },
  'Versa': {
    years: [2007, 2026],
    trims: {
      '2007-2011': ['1.8 S', '1.8 SL', '1.6 Base'],
      '2012-2019': ['S', 'S Plus', 'SV', 'SL', 'Note S', 'Note SV', 'Note SL', 'Note SR'],
      '2020-2023': ['S', 'SV', 'SR'],
      '2024-2026': ['S', 'SV', 'SR'],
    }
  },
  'Z': {
    years: [2003, 2026],
    trims: {
      '2003-2008': ['Base', 'Touring', 'Track', 'Grand Touring', 'Nismo', 'Roadster'],
      '2009-2020': ['Base', 'Sport', 'Sport Touring', 'Touring', 'Nismo', 'Nismo Tech'],
      '2023-2026': ['Sport', 'Performance', 'Nismo'],
    }
  },
  'Ariya': {
    years: [2023, 2026],
    trims: {
      '2023-2026': ['Engage', 'Engage+', 'Venture+', 'Evolve+', 'Empower+', 'Platinum+ e-4ORCE'],
    }
  },
  'Juke': {
    years: [2011, 2017],
    trims: {
      '2011-2014': ['S', 'SV', 'SL', 'Nismo', 'Nismo RS'],
      '2015-2017': ['S', 'SV', 'SL', 'Nismo', 'Nismo RS', 'Black Pearl Edition'],
    }
  },
  'Quest': {
    years: [2004, 2017],
    trims: {
      '2004-2009': ['3.5 S', '3.5 SE', '3.5 SL'],
      '2011-2017': ['S', 'SV', 'SL', 'Platinum', 'LE'],
    }
  },
  'Xterra': {
    years: [2005, 2015],
    trims: {
      '2005-2008': ['X', 'S', 'SE', 'Off-Road'],
      '2009-2015': ['X', 'S', 'SV', 'PRO-4X'],
    }
  },
};
