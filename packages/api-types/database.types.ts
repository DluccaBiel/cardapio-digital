export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ad_accounts: {
        Row: {
          balance: number
          client_id: string | null
          created_at: string
          currency: string
          external_account_id: string
          id: string
          is_watched: boolean
          last_synced_at: string | null
          name: string
          platform: Database["public"]["Enums"]["ad_platform"]
          spend_month: number
          status: string
          sync_error: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          balance?: number
          client_id?: string | null
          created_at?: string
          currency?: string
          external_account_id: string
          id?: string
          is_watched?: boolean
          last_synced_at?: string | null
          name: string
          platform?: Database["public"]["Enums"]["ad_platform"]
          spend_month?: number
          status?: string
          sync_error?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          balance?: number
          client_id?: string | null
          created_at?: string
          currency?: string
          external_account_id?: string
          id?: string
          is_watched?: boolean
          last_synced_at?: string | null
          name?: string
          platform?: Database["public"]["Enums"]["ad_platform"]
          spend_month?: number
          status?: string
          sync_error?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ad_accounts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "ad_accounts_ws_client_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          expires_at: string | null
          extension_id: string | null
          id: string
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          rate_limit_per_minute: number
          revoked_at: string | null
          scopes: string[]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          extension_id?: string | null
          id?: string
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          extension_id?: string | null
          id?: string
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          rate_limit_per_minute?: number
          revoked_at?: string | null
          scopes?: string[]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_extension_id_fkey"
            columns: ["extension_id"]
            isOneToOne: false
            referencedRelation: "extensions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_id: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          created_at: string
          entity_id: string | null
          entity_type: string
          id: number
          ip: unknown
          metadata: Json
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          actor_type: Database["public"]["Enums"]["audit_actor_type"]
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: never
          ip?: unknown
          metadata?: Json
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          actor_type?: Database["public"]["Enums"]["audit_actor_type"]
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: never
          ip?: unknown
          metadata?: Json
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      client_tags: {
        Row: {
          client_id: string
          created_at: string
          tag_id: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          tag_id: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          tag_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "client_tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "client_tags_ws_client_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "client_tags_ws_tag_fkey"
            columns: ["workspace_id", "tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      clients: {
        Row: {
          archived_at: string | null
          contact_name: string | null
          created_at: string
          delivery_status: Database["public"]["Enums"]["delivery_status"]
          document: string | null
          email: string | null
          id: string
          instagram: string | null
          legal_name: string | null
          monthly_fee: number | null
          name: string
          notes: string | null
          phone: string | null
          status: Database["public"]["Enums"]["client_status"]
          updated_at: string
          whatsapp: string | null
          workspace_id: string
        }
        Insert: {
          archived_at?: string | null
          contact_name?: string | null
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          document?: string | null
          email?: string | null
          id?: string
          instagram?: string | null
          legal_name?: string | null
          monthly_fee?: number | null
          name: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          whatsapp?: string | null
          workspace_id: string
        }
        Update: {
          archived_at?: string | null
          contact_name?: string | null
          created_at?: string
          delivery_status?: Database["public"]["Enums"]["delivery_status"]
          document?: string | null
          email?: string | null
          id?: string
          instagram?: string | null
          legal_name?: string | null
          monthly_fee?: number | null
          name?: string
          notes?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["client_status"]
          updated_at?: string
          whatsapp?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      extension_installs: {
        Row: {
          api_key_id: string | null
          created_at: string
          extension_id: string
          id: string
          installed_by: string | null
          last_seen_at: string | null
          status: string
          version: string | null
          workspace_id: string
        }
        Insert: {
          api_key_id?: string | null
          created_at?: string
          extension_id: string
          id?: string
          installed_by?: string | null
          last_seen_at?: string | null
          status?: string
          version?: string | null
          workspace_id: string
        }
        Update: {
          api_key_id?: string | null
          created_at?: string
          extension_id?: string
          id?: string
          installed_by?: string | null
          last_seen_at?: string | null
          status?: string
          version?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "extension_installs_extension_id_fkey"
            columns: ["extension_id"]
            isOneToOne: false
            referencedRelation: "extensions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_installs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "extension_installs_ws_key_fkey"
            columns: ["workspace_id", "api_key_id"]
            isOneToOne: false
            referencedRelation: "api_keys"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      extensions: {
        Row: {
          created_at: string
          description: string | null
          homepage_url: string | null
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          homepage_url?: string | null
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          homepage_url?: string | null
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      members: {
        Row: {
          created_at: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_addon_groups: {
        Row: {
          client_id: string
          created_at: string
          id: string
          max_qty: number
          min_qty: number
          name: string
          sort_order: number
          status: Database["public"]["Enums"]["menu_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          id?: string
          max_qty?: number
          min_qty?: number
          name: string
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          id?: string
          max_qty?: number
          min_qty?: number
          name?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_addon_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_addon_groups_ws_client_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      menu_categories: {
        Row: {
          client_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          sort_order: number
          status: Database["public"]["Enums"]["menu_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_categories_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_categories_ws_client_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      menu_image_history: {
        Row: {
          bytes: number
          checksum_sha256: string
          id: string
          menu_image_id: string | null
          mime_type: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["image_owner_type"]
          reason: string | null
          replaced_at: string
          replaced_by: string | null
          replaced_by_type: Database["public"]["Enums"]["audit_actor_type"]
          storage_path: string
          version: number
          workspace_id: string
        }
        Insert: {
          bytes: number
          checksum_sha256: string
          id?: string
          menu_image_id?: string | null
          mime_type?: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["image_owner_type"]
          reason?: string | null
          replaced_at?: string
          replaced_by?: string | null
          replaced_by_type?: Database["public"]["Enums"]["audit_actor_type"]
          storage_path: string
          version: number
          workspace_id: string
        }
        Update: {
          bytes?: number
          checksum_sha256?: string
          id?: string
          menu_image_id?: string | null
          mime_type?: string
          owner_id?: string
          owner_type?: Database["public"]["Enums"]["image_owner_type"]
          reason?: string | null
          replaced_at?: string
          replaced_by?: string | null
          replaced_by_type?: Database["public"]["Enums"]["audit_actor_type"]
          storage_path?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_image_history_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_image_history_ws_image_fkey"
            columns: ["workspace_id", "menu_image_id"]
            isOneToOne: false
            referencedRelation: "menu_images"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      menu_images: {
        Row: {
          bytes: number
          checksum_sha256: string
          created_at: string
          created_by: string | null
          height: number | null
          id: string
          is_current: boolean
          mime_type: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["image_owner_type"]
          storage_path: string
          version: number
          width: number | null
          workspace_id: string
        }
        Insert: {
          bytes: number
          checksum_sha256: string
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_current?: boolean
          mime_type?: string
          owner_id: string
          owner_type: Database["public"]["Enums"]["image_owner_type"]
          storage_path: string
          version?: number
          width?: number | null
          workspace_id: string
        }
        Update: {
          bytes?: number
          checksum_sha256?: string
          created_at?: string
          created_by?: string | null
          height?: number | null
          id?: string
          is_current?: boolean
          mime_type?: string
          owner_id?: string
          owner_type?: Database["public"]["Enums"]["image_owner_type"]
          storage_path?: string
          version?: number
          width?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_images_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      menu_item_addon_groups: {
        Row: {
          group_id: string
          item_id: string
          sort_order: number
          workspace_id: string
        }
        Insert: {
          group_id: string
          item_id: string
          sort_order?: number
          workspace_id: string
        }
        Update: {
          group_id?: string
          item_id?: string
          sort_order?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_item_addon_groups_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_item_addon_groups_ws_group_fkey"
            columns: ["workspace_id", "group_id"]
            isOneToOne: false
            referencedRelation: "menu_addon_groups"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "menu_item_addon_groups_ws_item_fkey"
            columns: ["workspace_id", "item_id"]
            isOneToOne: false
            referencedRelation: "menu_items"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      menu_items: {
        Row: {
          category_id: string
          client_id: string
          created_at: string
          description: string | null
          id: string
          name: string
          price: number
          sku: string | null
          sort_order: number
          status: Database["public"]["Enums"]["menu_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          category_id: string
          client_id: string
          created_at?: string
          description?: string | null
          id?: string
          name: string
          price: number
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          category_id?: string
          client_id?: string
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          price?: number
          sku?: string | null
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_items_ws_category_fkey"
            columns: ["workspace_id", "category_id"]
            isOneToOne: false
            referencedRelation: "menu_categories"
            referencedColumns: ["workspace_id", "id"]
          },
          {
            foreignKeyName: "menu_items_ws_client_fkey"
            columns: ["workspace_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      menu_subitems: {
        Row: {
          created_at: string
          group_id: string
          id: string
          name: string
          price_delta: number
          sort_order: number
          status: Database["public"]["Enums"]["menu_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          group_id: string
          id?: string
          name: string
          price_delta?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          group_id?: string
          id?: string
          name?: string
          price_delta?: number
          sort_order?: number
          status?: Database["public"]["Enums"]["menu_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "menu_subitems_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "menu_subitems_ws_group_fkey"
            columns: ["workspace_id", "group_id"]
            isOneToOne: false
            referencedRelation: "menu_addon_groups"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      tags: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          workspace_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          workspace_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          delivered_at: string | null
          event: string
          id: string
          next_retry_at: string | null
          payload: Json
          response_body: string | null
          response_status: number | null
          status: Database["public"]["Enums"]["webhook_delivery_status"]
          webhook_id: string
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          event: string
          id?: string
          next_retry_at?: string | null
          payload: Json
          response_body?: string | null
          response_status?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
          webhook_id: string
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          delivered_at?: string | null
          event?: string
          id?: string
          next_retry_at?: string | null
          payload?: Json
          response_body?: string | null
          response_status?: number | null
          status?: Database["public"]["Enums"]["webhook_delivery_status"]
          webhook_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_ws_webhook_fkey"
            columns: ["workspace_id", "webhook_id"]
            isOneToOne: false
            referencedRelation: "webhooks"
            referencedColumns: ["workspace_id", "id"]
          },
        ]
      }
      webhooks: {
        Row: {
          created_at: string
          created_by: string | null
          events: string[]
          failure_count: number
          id: string
          is_active: boolean
          last_failure_at: string | null
          last_success_at: string | null
          name: string
          secret: string
          updated_at: string
          url: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          name: string
          secret: string
          updated_at?: string
          url: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          events?: string[]
          failure_count?: number
          id?: string
          is_active?: boolean
          last_failure_at?: string | null
          last_success_at?: string | null
          name?: string
          secret?: string
          updated_at?: string
          url?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhooks_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          plan: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          plan?: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          plan?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      current_workspace_role: {
        Args: { ws: string }
        Returns: Database["public"]["Enums"]["member_role"]
      }
      has_workspace_role: {
        Args: {
          roles: Database["public"]["Enums"]["member_role"][]
          ws: string
        }
        Returns: boolean
      }
      is_workspace_member: { Args: { ws: string }; Returns: boolean }
      storage_workspace_id: { Args: { object_name: string }; Returns: string }
    }
    Enums: {
      ad_platform: "meta" | "google" | "tiktok" | "outro"
      audit_actor_type: "user" | "api_key" | "system"
      client_status: "ativo" | "pausado" | "encerrado"
      delivery_status: "no_prazo" | "atrasado" | "entregue" | "sem_entrega"
      image_owner_type: "menu_item" | "menu_subitem"
      member_role: "owner" | "coordenador" | "editor" | "visualizador"
      menu_status: "active" | "inactive" | "out_of_stock"
      webhook_delivery_status: "pending" | "delivered" | "failed" | "gave_up"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      ad_platform: ["meta", "google", "tiktok", "outro"],
      audit_actor_type: ["user", "api_key", "system"],
      client_status: ["ativo", "pausado", "encerrado"],
      delivery_status: ["no_prazo", "atrasado", "entregue", "sem_entrega"],
      image_owner_type: ["menu_item", "menu_subitem"],
      member_role: ["owner", "coordenador", "editor", "visualizador"],
      menu_status: ["active", "inactive", "out_of_stock"],
      webhook_delivery_status: ["pending", "delivered", "failed", "gave_up"],
    },
  },
} as const
