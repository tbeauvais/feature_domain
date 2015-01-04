require 'redis_connection'
require 'json'

class ModelAccess

  Client = ::RedisConnection.client

  HASH_KEY = 'content_models'

  def fetch_models
    models = Client.hgetall HASH_KEY
    models.keys.map {|key| JSON.parse(models[key])}
  end

  def model_names
    models = Client.hgetall HASH_KEY
    models.keys.map do |key|
      model = JSON.parse(models[key])
      {'id' => key, 'name' => model['name']}
    end
  end

  def fetch_model(id)
    model = Client.hget HASH_KEY, id
    model ? JSON.parse(model) : nil
  end

  def add_model(model)
    model['id'] = SecureRandom.uuid
    Client.hset HASH_KEY, model['id'], model.to_json
    model
  end

  def update_model(id, model)
    Client.hset HASH_KEY, id, model.to_json
    model
  end

  def delete_model(id)
    Client.hdel HASH_KEY, id
    rescue
      false
    true
  end

end