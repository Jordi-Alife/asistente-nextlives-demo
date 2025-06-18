// Función auxiliar para filtrar campos undefined
function filterUndefined(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  
  const filtered = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      if (Array.isArray(value)) {
        filtered[key] = value.map(item => 
          typeof item === 'object' ? filterUndefined(item) : item
        );
      } else if (typeof value === 'object' && value !== null) {
        filtered[key] = filterUndefined(value);
      } else {
        filtered[key] = value;
      }
    }
  }
  return filtered;
}

// Función para filtrar los datos del contexto según especificaciones
export function filtrarDatosContexto(data) {
  
  if (!data) {
    console.log("⚠️ No data found, returning as is");
    return data;
  }

  const resultado = {};

  // Filtrar datos de line
  if (data.line) {
    const line = data.line;
    resultado.line = {
      line_uuid: line.line_uuid,
      name: line.name,
      alias: line.alias,
      date_from: line.date_from,
      date_to: line.date_to,
      num_followers: line.num_followers,
      image_url: line.image_url,
      added: line.added,
      create_tree_automatically: line.create_tree_automatically,
      day_to_send_the_tree: line.day_to_send_the_tree,
      tree_anonymous_default_text: line.tree_anonymous_default_text,
      published_at: line.published_at,
      company_file_id: line.company_file_id,
      udiana_uuid: line.udiana_uuid,
      picture_all: line.picture_all,
      public_url: line.public_url,
      is_testing: line.is_testing,
      legal_accepted: line.legal_accepted,
      user_follows_lines: line.user_follows_lines
    };

    // Filtrar events
    if (line.events && Array.isArray(line.events)) {
      resultado.line.events = line.events.map(event => {
        const filteredEvent = {
          event_uuid: event.event_uuid,
          event_is_main: event.event_is_main,
          has_streaming: event.has_streaming,
          event_is_outsourced: event.event_is_outsourced,
          event_name: event.event_name,
          event_starts_at_localtime: event.event_starts_at_localtime,
          event_ends_at_localtime: event.event_ends_at_localtime,
          event_accomplish_at_localtime: event.event_accomplish_at_localtime,
          event_accomplish_at: event.event_accomplish_at,
          event_info: event.event_info,
          event_room: event.event_room,
          event_timezone: event.event_timezone,
          hide_event: event.hide_event,
          event_is_accomplished: event.event_is_accomplished
        };

        // Filtrar event_venue
        if (event.event_venue) {
          filteredEvent.event_venue = {
            venue_name: event.event_venue.venue_name,
            venue_add1: event.event_venue.venue_add1,
            venue_add2: event.event_venue.venue_add2,
            venue_city: event.event_venue.venue_city,
            venue_zip: event.event_venue.venue_zip,
            venue_province: event.event_venue.venue_province,
            venue_country: event.event_venue.venue_country,
            venue_phone_country_code: event.event_venue.venue_phone_country_code,
            venue_phone_number: event.event_venue.venue_phone_number,
            venue_web: event.event_venue.venue_web,
            venue_map_img: event.event_venue.venue_map_img,
            venue_map_lat: event.event_venue.venue_map_lat,
            venue_map_long: event.event_venue.venue_map_long,
            venue_map_zoom: event.event_venue.venue_map_zoom
          };
        }

        // Filtrar type
        if (event.type) {
          filteredEvent.type = {
            name: event.type.name
          };
        }

        return filteredEvent;
      });
    }

    // Filtrar company
    if (line.company) {
      const company = line.company;
      
      resultado.line.company = {
        name: company.name,
        initials: company.initials,
        tradename: company.tradename,
        country: company.country,
        language: company.language,
        address1: company.address1,
        address2: company.address2,
        city: company.city,
        zip: company.zip,
        province: company.province,
        currency: company.currency,
        phone_country_code: company.phone_country_code,
        phone_number: company.phone_number,
        map_lat: company.map_lat,
        map_long: company.map_long,
        map_img: company.map_img,
        is_indirect_payment: company.is_indirect_payment,
        email: company.email,
        timezone: company.timezone,
        allow_funerstream: company.allow_funerstream,
        time_to_accept_order: company.time_to_accept_order,
        start_time_of_service: company.start_time_of_service,
        end_time_of_service: company.end_time_of_service,
        can_use_stripe: company.can_use_stripe,
        is_smart_tv_enabled: company.is_smart_tv_enabled,
        create_tree_automatically: company.create_tree_automatically,
        tree_anonymous_default_text: company.tree_anonymous_default_text,
        ecommerce_enabled: company.ecommerce_enabled,
        style_api: company.style_api,
        picture_all: company.picture_all,
        image_logo: company.image_logo
      };

      // Filtrar cms_company_society
      if (company.cms_company_society) {
        resultado.line.company.cms_company_society = {
          name: company.cms_company_society.name,
          cif: company.cms_company_society.cif,
          address: company.cms_company_society.address,
          city: company.cms_company_society.city,
          zip: company.cms_company_society.zip,
          province: company.cms_company_society.province,
          country: company.cms_company_society.country
        };

        // Filtrar nested company dentro de cms_company_society (SIN campos prohibidos)
        if (company.cms_company_society.company) {
          const nestedCompany = company.cms_company_society.company;
          resultado.line.company.cms_company_society.company = {
            cmscompany_uuid: nestedCompany.cmscompany_uuid,
            cms_company_society_id: nestedCompany.cms_company_society_id,
            cms_company_delegation_id: nestedCompany.cms_company_delegation_id,
            name: nestedCompany.name,
            initials: nestedCompany.initials,
            tradename: nestedCompany.tradename,
            country: nestedCompany.country,
            language: nestedCompany.language,
            address1: nestedCompany.address1,
            address2: nestedCompany.address2,
            city: nestedCompany.city,
            zip: nestedCompany.zip,
            province: nestedCompany.province,
            currency: nestedCompany.currency,
            phone_country_code: nestedCompany.phone_country_code,
            phone_number: nestedCompany.phone_number,
            map_lat: nestedCompany.map_lat,
            map_long: nestedCompany.map_long,
            map_img: nestedCompany.map_img,
            is_indirect_payment: nestedCompany.is_indirect_payment,
            email: nestedCompany.email,
            timezone: nestedCompany.timezone,
            allow_funerstream: nestedCompany.allow_funerstream,
            time_to_accept_order: nestedCompany.time_to_accept_order,
            start_time_of_service: nestedCompany.start_time_of_service,
            end_time_of_service: nestedCompany.end_time_of_service,
            can_use_stripe: nestedCompany.can_use_stripe,
            is_smart_tv_enabled: nestedCompany.is_smart_tv_enabled,
            create_tree_automatically: nestedCompany.create_tree_automatically,
            tree_anonymous_default_text: nestedCompany.tree_anonymous_default_text,
            ecommerce_enabled: nestedCompany.ecommerce_enabled,
            style_api: nestedCompany.style_api,
            picture_all: nestedCompany.picture_all,
            image_logo: nestedCompany.image_logo
          };
        }
      }

      // Filtrar base
      if (company.base) {
        resultado.line.company.base = {
          cmscompany_uuid: company.base.cmscompany_uuid,
          cms_company_society_id: company.base.cms_company_society_id,
          cms_company_delegation_id: company.base.cms_company_delegation_id,
          name: company.base.name,
          initials: company.base.initials,
          tradename: company.base.tradename,
          country: company.base.country,
          language: company.base.language,
          address1: company.base.address1,
          address2: company.base.address2,
          city: company.base.city,
          zip: company.base.zip,
          province: company.base.province,
          currency: company.base.currency,
          phone_country_code: company.base.phone_country_code,
          phone_number: company.base.phone_number,
          map_lat: company.base.map_lat,
          map_long: company.base.map_long,
          map_img: company.base.map_img,
          is_indirect_payment: company.base.is_indirect_payment,
          email: company.base.email,
          timezone: company.base.timezone,
          allow_funerstream: company.base.allow_funerstream,
          time_to_accept_order: company.base.time_to_accept_order,
          start_time_of_service: company.base.start_time_of_service,
          end_time_of_service: company.base.end_time_of_service,
          can_use_stripe: company.base.can_use_stripe,
          is_smart_tv_enabled: company.base.is_smart_tv_enabled,
          create_tree_automatically: company.base.create_tree_automatically,
          tree_anonymous_default_text: company.base.tree_anonymous_default_text,
          ecommerce_enabled: company.base.ecommerce_enabled,
          style_api: company.base.style_api,
          picture_all: company.base.picture_all,
          image_logo: company.base.image_logo
          // Nota: company_optin y communication_configuration se excluyen intencionalmente
        };
      }
    }
  }

  // Filtrar datos de user
  if (data.user) {
    console.log("🧪 data.user recibido:", JSON.stringify(data.user, null, 2));
    const user = data.user;
    resultado.user = {
      user_uuid: user.user_uuid,
      name: user.name,
      phone_number: user.phone_number,
      phone_number_prefix: user.phone_number_prefix,
      phone_number_country_code: user.phone_number_country_code,
      phone_number_confirmed: user.phone_number_confirmed,
      active: user.active,
      timezone: user.timezone,
      profile_pic_url: user.profile_pic_url,
      last_login: user.last_login,
      added: user.added,
      language: user.language,
      unsubscribed_at: user.unsubscribed_at,
      picture_all: user.picture_all
    };

    // Filtrar orders (De momento, no se añaden las orders)
    if (false && user.orders && Array.isArray(user.orders)) {
      resultado.user.orders = user.orders.map(order => {
        const filteredOrder = {
          uuid: order.uuid,
          branch_id: order.branch_id,
          buyer_id: order.buyer_id,
          supplier_id: order.supplier_id,
          orderable_type: order.orderable_type,
          orderable_id: order.orderable_id,
          line_id: order.line_id,
          invoice_requested: order.invoice_requested,
          order_status: order.order_status,
          ribbon_text: order.ribbon_text,
          subtotal: order.subtotal,
          vat_prcnt: order.vat_prcnt,
          vat_amount: order.vat_amount,
          total: order.total,
          included_stripe_fee: order.included_stripe_fee,
          currency: order.currency,
          fact_name: order.fact_name,
          fact_surname: order.fact_surname,
          fact_email: order.fact_email,
          fact_cif: order.fact_cif,
          fact_address: order.fact_address,
          fact_city: order.fact_city,
          fact_zipcode: order.fact_zipcode,
          fact_county: order.fact_county,
          fact_country_iso2: order.fact_country_iso2,
          created_at: order.created_at,
          stripe_payment_id: order.stripe_payment_id,
          billing_status: order.billing_status,
          invoice_number: order.invoice_number,
          payment_type: order.payment_type,
          stripe_connect_account_ref: order.stripe_connect_account_ref,
          stripe_method_id: order.stripe_method_id,
          refund_balance_transaction_id: order.refund_balance_transaction_id,
          refunded_at: order.refunded_at,
          refund_fee: order.refund_fee,
          currency_to_euro_ratio: order.currency_to_euro_ratio,
          language: order.language,
          description: order.description,
          store_product: order.store_product
        };

        // Filtrar orderable
        if (order.orderable) {
          filteredOrder.orderable = {
            uuid: order.orderable.uuid,
            subtotal: order.orderable.subtotal,
            vat_prcnt: order.orderable.vat_prcnt,
            vat_amount: order.orderable.vat_amount,
            total: order.orderable.total,
            slug: order.orderable.slug,
            product_code: order.orderable.product_code,
            provider_ref: order.orderable.provider_ref,
            name: order.orderable.name,
            description: order.orderable.description,
            small_text: order.orderable.small_text,
            image_url: order.orderable.image_url
          };

          // Filtrar store_product_category
          if (order.orderable.store_product_category) {
            filteredOrder.orderable.store_product_category = {
              name: order.orderable.store_product_category.name
            };
          }
        }

        return filteredOrder;
      });
    }
  }

  // Filtrar campos undefined antes de devolver
  const resultadoFiltrado = filterUndefined(resultado);
  
  return resultadoFiltrado;
}
